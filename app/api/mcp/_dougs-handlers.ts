import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { contacts as contactsTable } from "../../../db/schema/contacts";
import { coworkingContracts } from "../../../db/schema/coworking";
import { type EntityAddress, entities as entitiesTable } from "../../../db/schema/entities";
import { invoices } from "../../../db/schema/invoices";
import { projects } from "../../../db/schema/projects";
import { resolveInvoiceDocument } from "../../../lib/billing/brand-documents";
import { brandTemplateFor } from "../../../lib/billing/brand-templates";
import { dougsLine } from "../../../lib/billing/dougs-lines";
import {
  buildDocumentPatch,
  buildDraftUpdatePayload,
  pushDougsSalesInvoiceDraft,
  resolveDougsClientData,
  withVerifiedLogo,
} from "../../../lib/billing/dougs-push";
import { db } from "../../../lib/db/server";
import {
  createDougsQuoteDraft,
  getDougsDraftUrl,
  getDougsQuoteUrl,
  getDougsSalesInvoiceDraft,
  updateDougsQuote,
  updateDougsSalesInvoice,
} from "../../../lib/dougs/client";
import { monthsBetween } from "../../../lib/schemas/coworking";

/**
 * Outils MCP qui orchestrent : push Dougs + écriture dans invoices.
 * Atomicité : si Dougs throw, on n'écrit rien en DB.
 *
 * Pas de revalidatePath — l'agent ne déclenche pas de cache invalidation UI.
 */

// ---------- Helper : clientData depuis une entité ----------

/**
 * Adaptateur vers `resolveDougsClientData`. Le helper local faisait la même
 * chose en moins bien : il prenait le résultat Dougs en bloc, donc il écrasait
 * la rue connue de Parade OS par une chaîne vide quand la recherche ne la
 * renvoyait pas, et il envoyait toujours `siret: null`.
 */
async function buildClientDataFromEntity(
  userId: string,
  entityName: string,
  fallback: {
    legalName?: string | null;
    siren: string | null;
    siret?: string | null;
    vatNumber: string | null;
    address: EntityAddress | null;
    deliveryAddress?: EntityAddress | null;
  },
  contactEmail: string | null,
): Promise<Record<string, unknown>> {
  return resolveDougsClientData({
    userId,
    isBtoB: true,
    searchName: entityName,
    local: {
      legalName: fallback.legalName ?? entityName,
      siren: fallback.siren,
      siret: fallback.siret ?? null,
      vatNumber: fallback.vatNumber,
      address: fallback.address,
      deliveryAddress: fallback.deliveryAddress ?? null,
      email: contactEmail,
    },
  });
}

// ---------- 1. push_project_quote ----------

export const pushProjectQuoteSchema = z.object({
  projectId: z.string().uuid(),
  subject: z.string().trim().max(500).default(""),
  thankYouNote: z.string().trim().max(2000).default(""),
  lines: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        description: z.string().trim().default(""),
        unit: z.string().trim().default("forfait"),
        quantity: z.number().positive(),
        unitAmount: z.number().nonnegative(),
        vatRate: z.number().min(0).max(1).default(0.2),
      }),
    )
    .min(1),
});

export async function pushProjectQuote(
  args: z.infer<typeof pushProjectQuoteSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({
      project: projects,
      entityName: entitiesTable.name,
      entityLegalName: entitiesTable.legalName,
      entitySiren: entitiesTable.siren,
      entitySiret: entitiesTable.siret,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      entityDeliveryAddress: entitiesTable.deliveryAddress,
      contactEmail: contactsTable.email,
      projectBillingTerms: projects.billingTerms,
    })
    .from(projects)
    .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
    .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
    .where(eq(projects.id, args.projectId))
    .limit(1);
  if (!row) throw new Error(`Projet ${args.projectId} introuvable.`);
  const { project } = row;
  if (project.kind !== "client") {
    throw new Error("Devis disponible uniquement pour les projets kind='client'.");
  }
  if (!project.entityId || !row.entityName) {
    throw new Error("Entité de facturation manquante sur le projet.");
  }

  const clientData = await buildClientDataFromEntity(
    ctx.userId,
    row.entityName,
    {
      legalName: row.entityLegalName,
      siren: row.entitySiren,
      siret: row.entitySiret,
      vatNumber: row.entityVatNumber,
      address: row.entityAddress,
      deliveryAddress: row.entityDeliveryAddress,
    },
    row.contactEmail,
  );

  const lines = args.lines.map((l) => ({
    title: l.title,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    vatRate: l.vatRate,
    discount: 0,
    discountUnit: "%",
    reference: null,
    amount: Math.round(l.quantity * l.unitAmount * 100) / 100,
    discountInEuros: 0,
    isPriceWithVat: false,
  }));

  const draft = await createDougsQuoteDraft(ctx.userId);
  // Mêmes mentions que depuis l'UI : logo de la marque, sous-titre, modalités.
  // `dueDateOption` est écarté — un devis a une expiration, pas une échéance.
  const { dueDateOption: _ignoré, ...quoteDocument } = (
    await resolveInvoiceDocument("automato", row.projectBillingTerms)
  ).document;

  const updated = await updateDougsQuote(ctx.userId, draft.id, {
    ...draft,
    ...buildDocumentPatch(draft as unknown as Record<string, unknown>, quoteDocument),
    subject: args.subject,
    thankYouNote: args.thankYouNote,
    clientData,
    lines,
  });

  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  // Upsert quote invoice (1 par projet).
  const [existingQuote] = await conn
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.projectId, args.projectId), eq(invoices.kind, "quote")))
    .limit(1);

  const quoteValues = {
    label: `Devis ${project.name}`,
    amountHt: total.toFixed(2),
    vatRate: brandTemplateFor("automato").defaultVatRate.toString(),
    status: "sent" as const,
    dougsQuoteId: updated.id,
    dougsReference: updated.reference,
    dougsStatus: updated.status ?? "DRAFT",
    invoicedAt: new Date(),
    dougsSyncedAt: new Date(),
    updatedAt: new Date(),
  };
  if (existingQuote) {
    await conn.update(invoices).set(quoteValues).where(eq(invoices.id, existingQuote.id));
  } else {
    await conn.insert(invoices).values({
      kind: "quote",
      brand: "automato",
      projectId: args.projectId,
      createdBy: ctx.userId,
      ...quoteValues,
    });
  }

  const url = await getDougsQuoteUrl(ctx.userId, updated.id);
  return {
    dougsQuoteId: updated.id,
    reference: updated.reference,
    status: updated.status ?? "DRAFT",
    url,
  };
}

// ---------- 2. push_project_milestone_invoice ----------

export const pushProjectMilestoneInvoiceSchema = z.object({
  projectId: z.string().uuid(),
  /** Si défini : facture l'existant. Sinon : crée un nouveau jalon. */
  milestoneId: z.string().uuid().optional(),
  type: z.enum(["acompte", "intermediaire", "solde"]).optional(),
  percent: z.number().min(0).max(150).optional(),
  amountHt: z.number().positive().optional(),
  label: z.string().trim().max(120).optional(),
});

export async function pushProjectMilestoneInvoice(
  args: z.infer<typeof pushProjectMilestoneInvoiceSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({
      project: projects,
      entityName: entitiesTable.name,
      entityLegalName: entitiesTable.legalName,
      entitySiren: entitiesTable.siren,
      entitySiret: entitiesTable.siret,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      entityDeliveryAddress: entitiesTable.deliveryAddress,
      contactEmail: contactsTable.email,
    })
    .from(projects)
    .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
    .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
    .where(eq(projects.id, args.projectId))
    .limit(1);
  if (!row) throw new Error(`Projet ${args.projectId} introuvable.`);
  const { project } = row;
  if (project.kind !== "client") {
    throw new Error("Facturation Dougs disponible uniquement pour les projets 'client'.");
  }
  if (!project.entityId || !row.entityName) {
    throw new Error("Entité de facturation manquante sur le projet.");
  }

  // Trouver le total Dougs depuis le devis lié, pour calcul %.
  const [quoteRow] = await conn
    .select({ dougsTotalHt: invoices.dougsTotalHt })
    .from(invoices)
    .where(and(eq(invoices.projectId, args.projectId), eq(invoices.kind, "quote")))
    .limit(1);

  // Charger l'invoice (jalon) existant si milestoneId fourni.
  let milestone: typeof invoices.$inferSelect | null = null;
  if (args.milestoneId) {
    const [m] = await conn
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, args.milestoneId), eq(invoices.kind, "milestone")))
      .limit(1);
    if (!m) throw new Error("Jalon introuvable.");
    milestone = m;
  }

  let amountHt: number;
  let label: string;
  let mType: "acompte" | "intermediaire" | "solde";
  let percent: number | null;

  if (milestone) {
    amountHt = Number(milestone.amountHt);
    label = milestone.label;
    mType = (milestone.milestoneType as "acompte" | "intermediaire" | "solde") ?? "intermediaire";
    percent = milestone.milestonePercent;
  } else {
    const valueHt =
      Number(quoteRow?.dougsTotalHt ?? project.valueAmount ?? project.budgetAmount ?? 0) || 0;
    amountHt =
      args.amountHt ?? (args.percent != null && valueHt > 0 ? (valueHt * args.percent) / 100 : 0);
    if (amountHt <= 0) {
      throw new Error("amountHt ou percent (avec valueAmount > 0) requis pour créer un jalon.");
    }
    percent = args.percent ?? (valueHt > 0 ? Math.round((amountHt / valueHt) * 100) : null);
    mType =
      args.type ??
      (percent != null && percent < 50
        ? "acompte"
        : percent != null && percent >= 50 && percent < 95
          ? "intermediaire"
          : "solde");
    label =
      args.label ??
      (mType === "acompte"
        ? `Acompte ${percent ?? ""} %`.trim()
        : mType === "solde"
          ? `Solde ${percent ?? "100"} %`.trim()
          : `Intermédiaire ${percent ?? ""} %`.trim());
  }

  if (amountHt <= 0) throw new Error("Montant du jalon = 0.");

  const clientData = await buildClientDataFromEntity(
    ctx.userId,
    row.entityName,
    {
      legalName: row.entityLegalName,
      siren: row.entitySiren,
      siret: row.entitySiret,
      vatNumber: row.entityVatNumber,
      address: row.entityAddress,
      deliveryAddress: row.entityDeliveryAddress,
    },
    row.contactEmail,
  );

  const template = brandTemplateFor("automato");
  // Conditions négociées sur le projet et logo réglé en base, comme l'action
  // UI : ce handler envoyait le gabarit brut, donc pas le même document.
  const terms = await resolveInvoiceDocument("automato", project.billingTerms);
  const ctxLines = {
    label,
    amountHt,
    vatRate: template.defaultVatRate,
    clientName: row.entityName,
    projectName: project.name,
    milestonePercent: percent ?? null,
  };

  const draft = await pushDougsSalesInvoiceDraft({
    userId: ctx.userId,
    clientData,
    lines: template.buildLines(ctxLines),
    subject: template.invoiceSubject(ctxLines),
    document: terms.document,
  });

  let milestoneInvoiceId: string;
  if (milestone) {
    await conn
      .update(invoices)
      .set({
        status: "sent",
        invoicedAt: new Date(),
        dougsInvoiceId: draft.id,
        dougsReference: draft.reference,
        dougsStatus: "DRAFT",
        dougsSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, milestone.id));
    milestoneInvoiceId = milestone.id;
  } else {
    const [inserted] = await conn
      .insert(invoices)
      .values({
        kind: "milestone",
        brand: "automato",
        projectId: args.projectId,
        label,
        amountHt: amountHt.toFixed(2),
        vatRate: template.defaultVatRate.toString(),
        status: "sent",
        milestoneType: mType,
        milestonePercent: percent,
        invoicedAt: new Date(),
        dougsInvoiceId: draft.id,
        dougsReference: draft.reference,
        dougsStatus: "DRAFT",
        dougsSyncedAt: new Date(),
        createdBy: ctx.userId,
      })
      .returning({ id: invoices.id });
    if (!inserted) throw new Error("Insertion jalon échouée.");
    milestoneInvoiceId = inserted.id;
  }

  const url = await getDougsDraftUrl(ctx.userId, draft.id);
  return {
    dougsInvoiceId: draft.id,
    reference: draft.reference,
    milestoneId: milestoneInvoiceId,
    milestoneLabel: label,
    url,
  };
}

// ---------- 3. push_coworking_invoice ----------

export const pushCoworkingInvoiceMcpSchema = z.object({
  coworkingInvoiceId: z.string().uuid(),
});

export async function pushCoworkingInvoiceMcp(
  args: z.infer<typeof pushCoworkingInvoiceMcpSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({
      invoice: invoices,
      contract: coworkingContracts,
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
      contactEmail: contactsTable.email,
      contactAddress: contactsTable.address,
      billToEntityName: entitiesTable.name,
      billToEntityLegalName: entitiesTable.legalName,
      billToEntitySiren: entitiesTable.siren,
      billToEntitySiret: entitiesTable.siret,
      billToEntityVatNumber: entitiesTable.vatNumber,
      billToEntityAddress: entitiesTable.address,
      billToEntityDeliveryAddress: entitiesTable.deliveryAddress,
    })
    .from(invoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(contactsTable, eq(contactsTable.id, coworkingContracts.contactId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, coworkingContracts.billToEntityId))
    .where(and(eq(invoices.id, args.coworkingInvoiceId), eq(invoices.kind, "coworking")))
    .limit(1);

  if (!row?.contract) throw new Error("Facture coworking introuvable.");
  const { invoice, contract } = row;
  if (!invoice.periodStart || !invoice.periodEnd) {
    throw new Error("Période manquante sur la facture.");
  }
  const isBtoB = Boolean(contract.billToEntityId);
  const searchName = isBtoB
    ? (row.billToEntityName ?? "")
    : `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim();
  if (!searchName) throw new Error("Nom client introuvable (entité ou contact manquant).");

  // Une seule voie pour B2B et B2C : la branche B2C ne cherchait pas le client
  // chez Dougs, donc elle n'en résolvait jamais le `clientId` et créait un
  // doublon à chaque push.
  const clientData = await resolveDougsClientData({
    userId: ctx.userId,
    isBtoB,
    searchName,
    local: {
      legalName: row.billToEntityLegalName ?? row.billToEntityName ?? null,
      siren: row.billToEntitySiren ?? null,
      siret: row.billToEntitySiret ?? null,
      vatNumber: row.billToEntityVatNumber ?? null,
      firstName: row.contactFirstName ?? null,
      lastName: row.contactLastName ?? null,
      address: isBtoB ? row.billToEntityAddress : row.contactAddress,
      deliveryAddress: isBtoB ? row.billToEntityDeliveryAddress : null,
      email: row.contactEmail ?? null,
    },
  });

  const template = brandTemplateFor(invoice.brand);
  const lineCtx = {
    label: invoice.label,
    amountHt: Number(invoice.amountHt),
    vatRate: Number(invoice.vatRate),
    clientName: searchName,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    months: monthsBetween(invoice.periodStart, invoice.periodEnd),
    desks: invoice.desks ?? contract.desks,
    unitPriceHt: Number(invoice.unitPriceHt ?? contract.unitPriceHt),
  };

  const terms = await resolveInvoiceDocument(invoice.brand, contract.billingTerms);
  const draft = await pushDougsSalesInvoiceDraft({
    userId: ctx.userId,
    clientData,
    lines: template.buildLines(lineCtx),
    subject: template.invoiceSubject(lineCtx),
    document: terms.document,
  });

  // Pas de passage à 'sent' ici : un brouillon Dougs n'est pas une facture
  // émise. Ce handler divergeait de l'action UI, qui ne touche pas au statut.
  // Seul l'envoi automatique (lib/coworking/auto-send.ts), qui finalise
  // vraiment, pose 'sent'.
  await conn
    .update(invoices)
    .set({
      dougsInvoiceId: draft.id,
      dougsReference: draft.reference,
      dougsStatus: "DRAFT",
      dougsSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, args.coworkingInvoiceId));

  const url = await getDougsDraftUrl(ctx.userId, draft.id);
  return { dougsInvoiceId: draft.id, reference: draft.reference, url };
}

// ---------- 4. Envoi d'un document au client ----------

/**
 * Envoi (ou aperçu) d'un devis ou d'une facture au client.
 *
 * `confirm` est obligatoire pour un envoi réel, et ce n'est pas une politesse :
 * l'appel finalise le document chez Dougs — numéro définitif, irréversible pour
 * une facture — puis expédie un mail à un tiers. Un agent ne doit le poser que
 * sur une instruction explicite de l'utilisateur. Sans `confirm`, on se limite
 * à l'aperçu, qui n'émet rien et part à l'utilisateur lui-même.
 */
export const sendDocumentMcpSchema = z.object({
  invoiceId: z.string().uuid(),
  /** Objet du message. */
  subject: z.string().trim().min(1).max(300),
  /** Corps du message, en **texte brut**. Le document voyage en pièce jointe. */
  body: z.string().trim().min(1).max(10000),
  /**
   * `true` = finalise et envoie au client. Absent ou `false` = aperçu.
   *
   * Un `confirm: true` ne suffit pas : le serveur exige qu'un aperçu du **même**
   * message soit parti avant, donc poser ce drapeau du premier coup échoue.
   */
  confirm: z.boolean().optional(),
});

export async function sendDocumentMcp(
  args: z.infer<typeof sendDocumentMcpSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({ kind: invoices.kind, label: invoices.label })
    .from(invoices)
    .where(eq(invoices.id, args.invoiceId))
    .limit(1);
  if (!row) throw new Error("Document introuvable.");

  const send = args.confirm === true;
  // On appelle le module serveur, pas la server action : une requête MCP n'a
  // pas de cookie Supabase, donc l'action ne saurait pas qui agit.
  const { sendProjectInvoiceCore, sendProjectQuoteCore } = await import(
    "../../../lib/billing/send-document"
  );
  const core = row.kind === "quote" ? sendProjectQuoteCore : sendProjectInvoiceCore;
  const result = await core({
    userId: ctx.userId,
    invoiceId: args.invoiceId,
    send,
    subject: args.subject,
    body: args.body,
  });

  return {
    document: row.label,
    kind: row.kind,
    ...result,
    note: send
      ? "Document finalisé chez Dougs et envoyé au client, message en texte brut avec le PDF en pièce jointe."
      : "Aperçu envoyé à l'utilisateur. Rien n'a été émis. Fais-lui valider le message, puis rappelle avec confirm=true et le même subject/body.",
  };
}

// ---------- Modification d'un brouillon ----------

const draftLineSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  unit: z.string().trim().default("forfait"),
  quantity: z.number().positive(),
  unitAmount: z.number().nonnegative(),
  vatRate: z.number().min(0).max(1).default(0.2),
});

export const updateDougsInvoiceDraftSchema = z
  .object({
    /** Facture Parade OS déjà poussée (brouillon Dougs lié). */
    invoiceId: z.string().uuid().optional(),
    /** Ou directement l'identifiant du brouillon Dougs. */
    dougsDraftId: z.string().trim().min(1).optional(),
    subject: z.string().trim().max(500).optional(),
    /** Remplace toutes les lignes. */
    lines: z.array(draftLineSchema).min(1).optional(),
    invoicerOthers: z.array(z.string().trim().max(300)).max(5).optional(),
    thankYouNote: z.string().trim().max(2000).nullable().optional(),
    footerOthers: z.array(z.string().trim().max(500)).max(5).optional(),
    paymentTerms: z.string().trim().max(300).optional(),
    dueDateOption: z.string().trim().max(30).optional(),
    client: z
      .object({
        name: z.string().trim().max(200).optional(),
        email: z.string().trim().email().optional(),
        street: z.string().trim().max(300).optional(),
        zipCode: z.string().trim().max(20).optional(),
        city: z.string().trim().max(120).optional(),
        country: z.string().trim().max(80).optional(),
      })
      .optional(),
  })
  .refine((v) => v.invoiceId || v.dougsDraftId, {
    message: "Fournis `invoiceId` ou `dougsDraftId`.",
  });

/**
 * Modifie un brouillon Dougs déjà poussé : lignes, objet, mentions, client.
 *
 * Seul un **brouillon** se modifie. Une facture finalisée a un numéro et
 * une existence comptable : la corriger passe par un avoir, pas par ici.
 * Ce qui n'est pas fourni est laissé tel quel ; le logo, lui, est toujours
 * revérifié (cf. `withVerifiedLogo`).
 */
export async function updateDougsInvoiceDraft(
  args: z.infer<typeof updateDougsInvoiceDraftSchema>,
  ctx: { userId: string },
) {
  let draftId = args.dougsDraftId ?? null;
  let invoiceRow: { id: string; dougsStatus: string | null; dougsInvoiceId: string | null } | null =
    null;
  if (args.invoiceId) {
    const conn = await db();
    const [row] = await conn
      .select({
        id: invoices.id,
        dougsStatus: invoices.dougsStatus,
        dougsInvoiceId: invoices.dougsInvoiceId,
      })
      .from(invoices)
      .where(eq(invoices.id, args.invoiceId))
      .limit(1);
    if (!row) throw new Error(`Facture ${args.invoiceId} introuvable.`);
    if (!row.dougsInvoiceId) {
      throw new Error("Cette facture n'a pas encore été poussée sur Dougs : rien à modifier.");
    }
    invoiceRow = row;
    draftId = row.dougsInvoiceId;
  }
  if (!draftId) throw new Error("Brouillon Dougs introuvable.");

  const draft = await getDougsSalesInvoiceDraft(ctx.userId, draftId);
  const status = String(draft.status ?? "").toLowerCase();
  if (status && status !== "draft") {
    throw new Error(
      `Le document Dougs ${draft.reference ?? draftId} n'est plus un brouillon (${draft.status}) : il faut un avoir, pas une modification.`,
    );
  }

  const document = await withVerifiedLogo(ctx.userId, {
    ...(args.invoicerOthers !== undefined ? { invoicerOthers: args.invoicerOthers } : {}),
    ...(args.thankYouNote !== undefined ? { thankYouNote: args.thankYouNote } : {}),
    ...(args.footerOthers !== undefined ? { footerOthers: args.footerOthers } : {}),
    ...(args.paymentTerms !== undefined ? { paymentTerms: args.paymentTerms } : {}),
    ...(args.dueDateOption !== undefined ? { dueDateOption: args.dueDateOption } : {}),
  });

  const payload = buildDraftUpdatePayload(draft as unknown as Record<string, unknown>, {
    subject: args.subject,
    lines: args.lines?.map((l) => dougsLine(l)),
    document,
    client: args.client,
  });
  const updated = await updateDougsSalesInvoice(ctx.userId, draftId, payload);

  const totalHt = (updated.lines as { amount?: number }[] | undefined)?.reduce(
    (acc, l) => acc + Number(l.amount ?? 0),
    0,
  );
  if (invoiceRow && totalHt !== undefined) {
    const conn = await db();
    await conn
      .update(invoices)
      .set({ dougsTotalHt: totalHt.toFixed(2), updatedAt: new Date() })
      .where(eq(invoices.id, invoiceRow.id));
  }

  return {
    dougsDraftId: draftId,
    reference: updated.reference ?? draft.reference ?? null,
    status: updated.status ?? "draft",
    subject: updated.subject ?? null,
    lines: (updated.lines as unknown[] | undefined)?.length ?? 0,
    totalHt: totalHt ?? null,
    url: await getDougsDraftUrl(ctx.userId, draftId),
  };
}
