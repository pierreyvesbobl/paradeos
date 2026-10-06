import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { dueDateFrom } from "@/lib/billing/billing-terms";
import { resolveInvoiceDocument } from "@/lib/billing/brand-documents";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import { deliverDocumentEmail } from "@/lib/billing/deliver-document";
import { assertPreviewed, messageDigest } from "@/lib/billing/preview-gate";
import { db } from "@/lib/db/server";
import {
  canFinalizeDougsSalesInvoice,
  downloadDougsQuoteDraftPdf,
  downloadDougsSalesInvoiceDraftPdf,
  finalizeDougsQuote,
  finalizeDougsSalesInvoice,
  getDougsQuote,
  pickDougsReference,
  pickDougsSalesInvoiceId,
} from "@/lib/dougs/client";
import { sendEmail } from "@/lib/email/client";
import { getUserEmails } from "@/lib/email/users";

export type SendDocumentArgs = {
  userId: string;
  invoiceId: string;
  /** `true` = on finalise et on envoie au client. `false` = aperçu. */
  send: boolean;
  /** Destinataire de l'aperçu. Ignoré lors d'un envoi réel. */
  previewTo?: string;
  /**
   * Objet et corps du message, **rédigés à la main** (ou par un agent via MCP).
   *
   * Les documents client ne suivent pas de gabarit : on écrit un vrai message
   * et le document voyage en pièce jointe. Le corps part en **texte brut** —
   * c'est ce qui lui donne l'allure d'un message écrit plutôt que d'un
   * publipostage. Le gabarit HTML reste réservé aux envois automatiques, où
   * personne n'est là pour rédiger.
   */
  subject: string;
  body: string;
};

export type SendDocumentResult =
  | { previewed: true; to: string }
  | { sent: true; reference: string; to: string };

/** Contexte commun : la facture, son projet, son client et ses conditions. */
async function loadProjectDocument(invoiceId: string) {
  const conn = await db();
  const [row] = await conn
    .select({
      invoice: invoices,
      project: projects,
      entityName: entitiesTable.name,
      entityLegalName: entitiesTable.legalName,
      contactEmail: contactsTable.email,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
    .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  // On renarrow explicitement : destructurer `row` ferait perdre à TypeScript
  // le bénéfice de la garde ci-dessus.
  const project = row?.project;
  if (!row || !project) throw new Error("Document ou projet introuvable.");
  return {
    conn,
    project,
    invoice: row.invoice,
    entityName: row.entityName,
    entityLegalName: row.entityLegalName,
    contactEmail: row.contactEmail,
  };
}

/**
 * Destinataire effectif. Un envoi va au contact du projet ; un aperçu va à
 * l'adresse demandée, ou à défaut à celle de l'utilisateur — c'est le cas
 * normal : on se l'envoie pour vérifier.
 */
async function resolveRecipient(args: {
  send: boolean;
  previewTo?: string;
  contactEmail: string | null;
  userId: string;
}): Promise<string> {
  if (args.send) {
    const to = args.contactEmail?.trim();
    if (!to) throw new Error("Aucune adresse : renseigne l'email du contact du projet.");
    return to;
  }
  if (args.previewTo) return args.previewTo;
  const emails = await getUserEmails([args.userId]);
  const own = emails[args.userId];
  if (!own) throw new Error("Impossible de retrouver ton adresse : précise un destinataire.");
  return own;
}

/**
 * Envoie (ou prévisualise) une facture projet — jalon ou facture libre.
 *
 * Un envoi réel finalise la facture : numéro définitif, irréversible. On
 * contrôle `can-finalize` d'abord et on refuse plutôt que de forcer, comme
 * pour le coworking.
 */
export async function sendProjectInvoiceCore(input: SendDocumentArgs): Promise<SendDocumentResult> {
  const user = { id: input.userId };
  const { conn, invoice, project, entityName, entityLegalName, contactEmail } =
    await loadProjectDocument(input.invoiceId);

  if (invoice.kind === "quote") throw new Error("Utiliser l'envoi de devis pour un devis.");
  if (!invoice.dougsInvoiceId) throw new Error("Pousser la facture sur Dougs avant de l'envoyer.");

  const recipient = await resolveRecipient({
    send: input.send,
    previewTo: input.previewTo,
    contactEmail,
    userId: user.id,
  });

  const template = brandTemplateFor(invoice.brand);
  const terms = await resolveInvoiceDocument(invoice.brand, project.billingTerms);
  const amountHt = Number(invoice.amountHt);
  const ctx = {
    label: invoice.label,
    amountHt,
    vatRate: Number(invoice.vatRate),
    clientName: entityLegalName ?? entityName ?? project.name,
    projectName: project.name,
    milestonePercent: invoice.milestonePercent,
  };
  const mail = { subject: input.subject, body: input.body };
  const digest = messageDigest(mail.subject, mail.body);

  const isDraft = (invoice.dougsStatus ?? "DRAFT").toUpperCase() === "DRAFT";

  // --- Aperçu : le PDF du brouillon, rien d'émis. ---
  if (!input.send) {
    if (!isDraft) throw new Error("Facture déjà émise : l'aperçu n'a plus d'objet.");
    const pdf = await downloadDougsSalesInvoiceDraftPdf(user.id, invoice.dougsInvoiceId);
    const res = await sendEmail({
      to: recipient,
      subject: `[Aperçu] ${mail.subject}`,
      text: mail.body,
      fromName: template.senderName,
      tags: [{ name: "type", value: "invoice-preview" }],
      attachments: [{ filename: "apercu-facture.pdf", content: pdf.buffer }],
    });
    if (!res.delivered) throw new Error("Aperçu non expédié (EMAIL_DELIVERY ≠ resend).");
    // Trace l'aperçu : c'est lui qui débloque l'envoi au client.
    await conn
      .update(invoices)
      .set({ previewSentAt: new Date(), previewDigest: digest, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    return { previewed: true as const, to: recipient };
  }

  // --- Envoi réel. ---
  assertPreviewed({
    noun: "facture",
    previewDigest: invoice.previewDigest,
    previewSentAt: invoice.previewSentAt,
    digest,
  });

  let documentId = invoice.dougsInvoiceId;
  let reference = invoice.dougsReference ?? documentId;

  if (isDraft) {
    const blockers = await canFinalizeDougsSalesInvoice(user.id, documentId);
    if (blockers.length > 0) {
      throw new Error(
        `Dougs refuse de finaliser : ${blockers.map((b) => `${b.field} — ${b.message}`).join(" / ")}`,
      );
    }
    const finalized = await finalizeDougsSalesInvoice(user.id, documentId);
    // `finalized.id` est celui du brouillon ; la facture émise en a un autre,
    // exposé par `salesInvoiceId`. Le confondre fait échouer l'envoi en 404.
    documentId = pickDougsSalesInvoiceId(finalized) ?? documentId;
    reference = pickDougsReference(finalized) ?? reference;

    const invoicedAt = new Date();
    await conn
      .update(invoices)
      .set({
        status: "sent",
        invoicedAt,
        dueDate: toIsoDate(dueDateFrom(invoicedAt, terms.dueDays)),
        dougsInvoiceId: documentId,
        dougsReference: reference,
        dougsStatus: "WAITING",
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id));
  }

  await deliverDocumentEmail({
    userId: user.id,
    documentId,
    documentKind: "invoice",
    recipient,
    reference,
    brand: invoice.brand,
    mail,
    archiveInvoiceId: invoice.id,
    clientName: ctx.clientName,
  });

  await conn
    .update(invoices)
    .set({ autoSentAt: new Date(), autoSendError: null, updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));

  revalidateTag(`dougs:${user.id}`, { expire: 0 });
  revalidatePath(`/projets/${project.id}`);
  revalidatePath("/compta");
  return { sent: true as const, reference, to: recipient };
}

/**
 * Envoie (ou prévisualise) le devis d'un projet.
 *
 * Un envoi finalise le devis : il reçoit son numéro et passe en attente de
 * réponse. Moins engageant qu'une facture — un devis ne consomme pas la
 * séquence comptable — mais ce n'est pas annulable d'un clic.
 */
export async function sendProjectQuoteCore(input: SendDocumentArgs): Promise<SendDocumentResult> {
  const user = { id: input.userId };
  // Ni le nom du client ni celui du projet ne servent plus ici : le message
  // est rédigé à la main, et la confirmation qui nomme le destinataire se fait
  // côté UI.
  const { conn, invoice, project, contactEmail } = await loadProjectDocument(input.invoiceId);

  if (invoice.kind !== "quote") throw new Error("Cette facture n'est pas un devis.");
  if (!invoice.dougsQuoteId) throw new Error("Pousser le devis sur Dougs avant de l'envoyer.");

  const recipient = await resolveRecipient({
    send: input.send,
    previewTo: input.previewTo,
    contactEmail,
    userId: user.id,
  });

  // Seul le nom d'expéditeur vient de la marque : le message est rédigé.
  const template = brandTemplateFor(invoice.brand);
  const mail = { subject: input.subject, body: input.body };
  const digest = messageDigest(mail.subject, mail.body);
  const isDraft = (invoice.dougsStatus ?? "DRAFT").toUpperCase() === "DRAFT";

  if (!input.send) {
    if (!isDraft) throw new Error("Devis déjà finalisé : l'aperçu n'a plus d'objet.");
    const pdf = await downloadDougsQuoteDraftPdf(user.id, invoice.dougsQuoteId);
    const res = await sendEmail({
      to: recipient,
      subject: `[Aperçu] ${mail.subject}`,
      text: mail.body,
      fromName: template.senderName,
      tags: [{ name: "type", value: "quote-preview" }],
      attachments: [{ filename: "apercu-devis.pdf", content: pdf.buffer }],
    });
    if (!res.delivered) throw new Error("Aperçu non expédié (EMAIL_DELIVERY ≠ resend).");
    await conn
      .update(invoices)
      .set({ previewSentAt: new Date(), previewDigest: digest, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    return { previewed: true as const, to: recipient };
  }

  assertPreviewed({
    noun: "devis",
    previewDigest: invoice.previewDigest,
    previewSentAt: invoice.previewSentAt,
    digest,
  });

  let reference = invoice.dougsReference ?? invoice.dougsQuoteId;
  if (isDraft) {
    const finalized = await finalizeDougsQuote(user.id, invoice.dougsQuoteId);
    reference = pickDougsReference(finalized) ?? reference;
    await conn
      .update(invoices)
      .set({
        status: "sent",
        invoicedAt: invoice.invoicedAt ?? new Date(),
        dougsReference: reference,
        dougsStatus: (finalized?.status as string) ?? "PENDING",
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id));
  }

  // Le devis finalisé porte son PDF ; on le relit pour y trouver le fichier.
  const fresh = await getDougsQuote(user.id, invoice.dougsQuoteId);
  await deliverDocumentEmail({
    userId: user.id,
    documentId: invoice.dougsQuoteId,
    documentKind: "quote",
    recipient,
    reference,
    brand: invoice.brand,
    mail,
    payload: fresh as never,
  });

  await conn
    .update(invoices)
    .set({ autoSentAt: new Date(), autoSendError: null, updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));

  revalidateTag(`dougs:${user.id}`, { expire: 0 });
  revalidatePath(`/projets/${project.id}`);
  return { sent: true as const, reference, to: recipient };
}

/** `invoices.due_date` est une colonne `date`, pas un timestamp. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
