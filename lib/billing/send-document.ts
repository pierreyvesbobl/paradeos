import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { dueDateFrom } from "@/lib/billing/billing-terms";
import { resolveInvoiceDocument } from "@/lib/billing/brand-documents";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import { deliverDocumentEmail } from "@/lib/billing/deliver-document";
import { assertPreviewed, messageDigest, normalizeCc } from "@/lib/billing/preview-gate";
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
  /**
   * Adresses en copie du message client (un assistant, un second
   * interlocuteur…). Le destinataire principal reste le contact du projet
   * (ou du contrat, pour le coworking).
   * L'aperçu ne part qu'à l'utilisateur, mais il annonce ces copies et elles
   * entrent dans l'empreinte : en ajouter une après l'aperçu exige d'en
   * renvoyer un.
   */
  cc?: string[];
};

export type SendDocumentResult =
  | { previewed: true; to: string; cc: string[] }
  | { sent: true; reference: string; to: string; cc: string[] };

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
 * Contexte d'une facture à envoyer, quelle que soit son origine : un projet
 * (jalon, facture libre) ou un contrat coworking. Ce qui change d'une origine
 * à l'autre se résume au destinataire, au nom du client, aux conditions de
 * paiement et aux pages à rafraîchir ; le reste du parcours est commun.
 */
async function loadInvoiceDocument(invoiceId: string) {
  const conn = await db();
  const [head] = await conn
    .select({ kind: invoices.kind })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!head) throw new Error("Document introuvable.");

  if (head.kind !== "coworking") {
    const { invoice, project, entityName, entityLegalName, contactEmail } =
      await loadProjectDocument(invoiceId);
    return {
      conn,
      invoice,
      contactEmail,
      clientName: entityLegalName ?? entityName ?? project.name,
      billingTerms: project.billingTerms,
      paths: [`/projets/${project.id}`, "/compta"],
    };
  }

  const [row] = await conn
    .select({
      invoice: invoices,
      contract: coworkingContracts,
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
      contactEmail: contactsTable.email,
      entityName: entitiesTable.name,
      entityLegalName: entitiesTable.legalName,
    })
    .from(invoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(contactsTable, eq(contactsTable.id, coworkingContracts.contactId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, coworkingContracts.billToEntityId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  const contract = row?.contract;
  if (!row || !contract) throw new Error("Facture coworking ou contrat introuvable.");
  // Même garde que l'envoi automatique : G&O facture en son nom, ce n'est pas
  // à Parade d'émettre — et une facture finalisée ne s'annule que par un avoir.
  if (row.invoice.billedBy === "g_and_o") {
    throw new Error("Facture encaissée par G&O : ce n'est pas à Parade de l'émettre.");
  }
  const contactName = `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim();
  return {
    conn,
    invoice: row.invoice,
    contactEmail: row.contactEmail,
    clientName: contract.billToEntityId
      ? (row.entityLegalName ?? row.entityName ?? contract.name)
      : contactName || contract.name,
    billingTerms: contract.billingTerms,
    paths: ["/coworking", `/coworking/factures/${invoiceId}`, "/compta"],
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
    if (!to) throw new Error("Aucune adresse : renseigne l'email du contact du client.");
    return to;
  }
  if (args.previewTo) return args.previewTo;
  const emails = await getUserEmails([args.userId]);
  const own = emails[args.userId];
  if (!own) throw new Error("Impossible de retrouver ton adresse : précise un destinataire.");
  return own;
}

/**
 * Corps de l'aperçu : le message tel quel, précédé de la liste des
 * destinataires réels. L'utilisateur relit ainsi aussi **à qui** ça part, pas
 * seulement quoi — c'est ce que l'aperçu doit permettre de valider.
 */
function previewText(args: { contactEmail: string | null; cc: string[]; body: string }): string {
  const lines = [`À : ${args.contactEmail?.trim() || "(aucune adresse sur le contact du client)"}`];
  if (args.cc.length > 0) lines.push(`Cc : ${args.cc.join(", ")}`);
  return `${lines.join("\n")}\n\n----------\n\n${args.body}`;
}

/**
 * Envoie (ou prévisualise) une facture : jalon ou facture libre d'un projet,
 * ou facture coworking.
 *
 * Un envoi réel finalise la facture : numéro définitif, irréversible. On
 * contrôle `can-finalize` d'abord et on refuse plutôt que de forcer, comme
 * l'envoi automatique du coworking.
 */
export async function sendInvoiceCore(input: SendDocumentArgs): Promise<SendDocumentResult> {
  const user = { id: input.userId };
  const { conn, invoice, contactEmail, clientName, billingTerms, paths } =
    await loadInvoiceDocument(input.invoiceId);

  if (invoice.kind === "quote") throw new Error("Utiliser l'envoi de devis pour un devis.");
  if (!invoice.dougsInvoiceId) throw new Error("Pousser la facture sur Dougs avant de l'envoyer.");

  const recipient = await resolveRecipient({
    send: input.send,
    previewTo: input.previewTo,
    contactEmail,
    userId: user.id,
  });

  const template = brandTemplateFor(invoice.brand);
  const terms = await resolveInvoiceDocument(invoice.brand, billingTerms);
  const mail = { subject: input.subject, body: input.body };
  const cc = normalizeCc(input.cc);
  const digest = messageDigest(mail.subject, mail.body, cc);

  const isDraft = (invoice.dougsStatus ?? "DRAFT").toUpperCase() === "DRAFT";

  // --- Aperçu : le PDF du brouillon, rien d'émis. ---
  if (!input.send) {
    if (!isDraft) throw new Error("Facture déjà émise : l'aperçu n'a plus d'objet.");
    const pdf = await downloadDougsSalesInvoiceDraftPdf(user.id, invoice.dougsInvoiceId);
    const res = await sendEmail({
      to: recipient,
      subject: `[Aperçu] ${mail.subject}`,
      text: previewText({ contactEmail, cc, body: mail.body }),
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
    return { previewed: true as const, to: recipient, cc };
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
    cc,
    reference,
    brand: invoice.brand,
    mail,
    archiveInvoiceId: invoice.id,
    clientName,
  });

  await conn
    .update(invoices)
    .set({ autoSentAt: new Date(), autoSendError: null, updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));

  revalidateTag(`dougs:${user.id}`, { expire: 0 });
  for (const path of paths) revalidatePath(path);
  return { sent: true as const, reference, to: recipient, cc };
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
  const cc = normalizeCc(input.cc);
  const digest = messageDigest(mail.subject, mail.body, cc);
  const isDraft = (invoice.dougsStatus ?? "DRAFT").toUpperCase() === "DRAFT";

  if (!input.send) {
    if (!isDraft) throw new Error("Devis déjà finalisé : l'aperçu n'a plus d'objet.");
    const pdf = await downloadDougsQuoteDraftPdf(user.id, invoice.dougsQuoteId);
    const res = await sendEmail({
      to: recipient,
      subject: `[Aperçu] ${mail.subject}`,
      text: previewText({ contactEmail, cc, body: mail.body }),
      fromName: template.senderName,
      tags: [{ name: "type", value: "quote-preview" }],
      attachments: [{ filename: "apercu-devis.pdf", content: pdf.buffer }],
    });
    if (!res.delivered) throw new Error("Aperçu non expédié (EMAIL_DELIVERY ≠ resend).");
    await conn
      .update(invoices)
      .set({ previewSentAt: new Date(), previewDigest: digest, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    return { previewed: true as const, to: recipient, cc };
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
    cc,
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
  return { sent: true as const, reference, to: recipient, cc };
}

/** `invoices.due_date` est une colonne `date`, pas un timestamp. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
