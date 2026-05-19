"use server";

import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  getDougsQuote,
  getDougsSalesInvoice,
  pickDougsHt,
  pickDougsIssuedAt,
  pickDougsPaidAt,
  pickDougsStatus,
  pickDougsTtc,
  pickDougsVat,
} from "@/lib/dougs/client";
import { monthsBetween } from "@/lib/schemas/coworking";
import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function toNumeric(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : null;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Accepte un UUID brut OU une URL Dougs et renvoie l'UUID extrait.
 * Couvre les patterns d'URL Dougs (sales-invoice / quote / drafts).
 */
function extractDougsUuid(input: string): string {
  const match = input.trim().match(UUID_RE);
  if (!match) {
    throw new Error(
      "ID Dougs introuvable. Colle un UUID ou une URL Dougs (.../sales-invoice... ou .../quote...).",
    );
  }
  return match[0];
}

// =====================================================================
// CRUD générique
// =====================================================================

const upsertInvoiceSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  kind: z.enum(["quote", "milestone", "coworking", "one_off", "credit_note"]),
  projectId: z.string().uuid().nullable().optional(),
  coworkingContractId: z.string().uuid().nullable().optional(),
  cancelsInvoiceId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(120).nullable().optional(),
  amountHt: z.number().nonnegative(),
  vatRate: z.number().min(0).max(1).default(0.2),
  status: z.enum(["draft", "sent", "accepted", "refused", "paid"]).default("draft"),
  milestoneType: z.enum(["acompte", "intermediaire", "solde"]).nullable().optional(),
  milestonePercent: z.number().int().min(0).max(100).nullable().optional(),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  desks: z.number().int().positive().nullable().optional(),
  unitPriceHt: z.number().nonnegative().nullable().optional(),
  billedBy: z.enum(["parade", "g_and_o"]).nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

/**
 * Crée ou met à jour une facture (tout `kind`). UPSERT par `id` si fourni.
 * Garde les champs Dougs intacts (utilise linkInvoiceDougs pour les modifier).
 */
export const upsertInvoice = action(upsertInvoiceSchema, async ({ input, user }) => {
  const conn = await db();
  const baseValues = {
    kind: input.kind,
    projectId: input.projectId ?? null,
    coworkingContractId: input.coworkingContractId ?? null,
    cancelsInvoiceId: input.cancelsInvoiceId ?? null,
    label: input.label,
    reference: input.reference ?? null,
    amountHt: toNumeric(input.amountHt) ?? "0",
    vatRate: toNumeric(input.vatRate) ?? "0.2",
    status: input.status,
    milestoneType: input.milestoneType ?? null,
    milestonePercent: input.milestonePercent ?? null,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    desks: input.desks ?? null,
    unitPriceHt: toNumeric(input.unitPriceHt ?? null),
    billedBy: input.billedBy ?? null,
    notes: input.notes ?? null,
    updatedAt: new Date(),
  };

  let id: string;
  if (input.id) {
    const [row] = await conn
      .update(invoices)
      .set(baseValues)
      .where(eq(invoices.id, input.id))
      .returning({ id: invoices.id });
    if (!row) throw new Error("Facture introuvable.");
    id = row.id;
  } else {
    const [row] = await conn
      .insert(invoices)
      .values({ ...baseValues, createdBy: user.id })
      .returning({ id: invoices.id });
    if (!row) throw new Error("Création échouée.");
    id = row.id;
  }
  revalidatePathsForInvoice(input.projectId ?? null, input.coworkingContractId ?? null, id);
  revalidatePath("/compta");
  return { id };
});

export const deleteInvoice = action(z.object({ id: z.string().uuid() }), async ({ input }) => {
  const conn = await db();
  const [row] = await conn
    .select({
      projectId: invoices.projectId,
      coworkingContractId: invoices.coworkingContractId,
    })
    .from(invoices)
    .where(eq(invoices.id, input.id))
    .limit(1);
  await conn.delete(invoices).where(eq(invoices.id, input.id));
  if (row) revalidatePathsForInvoice(row.projectId, row.coworkingContractId, input.id);
  revalidatePath("/compta");
  return { ok: true as const };
});

export const setInvoiceStatus = action(
  z.object({
    id: z.string().uuid(),
    status: z.enum(["draft", "sent", "accepted", "refused", "paid"]),
  }),
  async ({ input }) => {
    const conn = await db();
    const now = new Date();
    const [existing] = await conn
      .select({
        invoicedAt: invoices.invoicedAt,
        paidAt: invoices.paidAt,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Facture introuvable.");

    const nextInvoicedAt = input.status === "draft" ? null : (existing.invoicedAt ?? now);
    const nextPaidAt =
      input.status === "paid"
        ? (existing.paidAt ?? now)
        : input.status === "draft"
          ? null
          : existing.paidAt;

    await conn
      .update(invoices)
      .set({ status: input.status, invoicedAt: nextInvoicedAt, paidAt: nextPaidAt, updatedAt: now })
      .where(eq(invoices.id, input.id));

    revalidatePathsForInvoice(existing.projectId, existing.coworkingContractId, input.id);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

// =====================================================================
// Helpers spécifiques jalons projet
// =====================================================================

const seedSchema = z.object({
  projectId: z.string().uuid(),
  totalHt: z.number().nonnegative(),
  acomptePercent: z.number().min(0).max(100).default(40),
});

/**
 * Crée le split par défaut acompte/solde sur un projet. 40/60 par
 * défaut (préférence user). Idempotent : ne crée pas si des jalons
 * existent déjà.
 */
export const seedProjectMilestones = action(seedSchema, async ({ input, user }) => {
  const conn = await db();
  const existing = await conn
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.projectId, input.projectId), eq(invoices.kind, "milestone")));
  if (existing.length > 0) return { ok: true as const, created: 0 };

  const acomptePct = input.acomptePercent;
  const acompteHt = Math.round(((input.totalHt * acomptePct) / 100) * 100) / 100;
  const soldeHt = Math.round((input.totalHt - acompteHt) * 100) / 100;
  const soldePct = 100 - acomptePct;

  await conn.insert(invoices).values([
    {
      kind: "milestone",
      projectId: input.projectId,
      label: `Acompte ${acomptePct} %`,
      amountHt: toNumeric(acompteHt) ?? "0",
      vatRate: "0.2",
      status: "draft",
      milestoneType: "acompte",
      milestonePercent: acomptePct,
      createdBy: user.id,
    },
    {
      kind: "milestone",
      projectId: input.projectId,
      label: `Solde ${soldePct} %`,
      amountHt: toNumeric(soldeHt) ?? "0",
      vatRate: "0.2",
      status: "draft",
      milestoneType: "solde",
      milestonePercent: soldePct,
      createdBy: user.id,
    },
  ]);

  revalidatePath(`/projets/${input.projectId}`);
  revalidatePath("/compta");
  return { ok: true as const, created: 2 };
});

// =====================================================================
// Helpers spécifiques coworking
// =====================================================================

const createCoworkingSchema = z.object({
  contractId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  periodStart: z.string(),
  periodEnd: z.string(),
  invoiceDate: z.string().nullable().optional(),
  desks: z.number().int().positive(),
  unitPriceHt: z.number().nonnegative(),
  vatRate: z.number().min(0).max(1).default(0.2),
  billedBy: z.enum(["parade", "g_and_o"]).default("parade"),
  status: z.enum(["draft", "sent", "paid"]).default("draft"),
  notes: z.string().nullable().optional(),
});

export const createCoworkingInvoice = action(createCoworkingSchema, async ({ input, user }) => {
  const conn = await db();
  // Période × prix mensuel : 3 mois pour un trimestre, 1 pour un mois.
  // Sans le facteur "mois", une facture trimestrielle stockait le tiers
  // du vrai montant.
  const months = monthsBetween(input.periodStart, input.periodEnd);
  const amountHt = Math.round(input.desks * input.unitPriceHt * months * 100) / 100;
  const [row] = await conn
    .insert(invoices)
    .values({
      kind: "coworking",
      coworkingContractId: input.contractId,
      label: input.name,
      amountHt: toNumeric(amountHt) ?? "0",
      vatRate: toNumeric(input.vatRate) ?? "0.2",
      status: input.status,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      desks: input.desks,
      unitPriceHt: toNumeric(input.unitPriceHt) ?? "0",
      billedBy: input.billedBy,
      invoicedAt: input.invoiceDate ? new Date(input.invoiceDate) : null,
      notes: input.notes ?? null,
      createdBy: user.id,
    })
    .returning({ id: invoices.id });

  revalidatePath("/coworking");
  revalidatePath(`/coworking/contrats/${input.contractId}`);
  revalidatePath("/compta");
  return { id: row?.id };
});

const updateCoworkingSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  invoiceDate: z.string().nullable().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  status: z.enum(["draft", "sent", "paid"]).optional(),
  billedBy: z.enum(["parade", "g_and_o"]).optional(),
  desks: z.number().int().positive().optional(),
  unitPriceHt: z.number().nonnegative().optional(),
  vatRate: z.number().min(0).max(1).optional(),
  notes: z.string().nullable().optional(),
});

export const updateCoworkingInvoice = action(updateCoworkingSchema, async ({ input }) => {
  const conn = await db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) update.label = input.name;
  if (input.invoiceDate !== undefined) {
    update.invoicedAt = input.invoiceDate ? new Date(input.invoiceDate) : null;
  }
  if (input.periodStart !== undefined) update.periodStart = input.periodStart;
  if (input.periodEnd !== undefined) update.periodEnd = input.periodEnd;
  if (input.status !== undefined) update.status = input.status;
  if (input.billedBy !== undefined) update.billedBy = input.billedBy;
  if (input.desks !== undefined) update.desks = input.desks;
  if (input.unitPriceHt !== undefined) update.unitPriceHt = toNumeric(input.unitPriceHt);
  if (input.vatRate !== undefined) update.vatRate = toNumeric(input.vatRate);
  if (input.notes !== undefined) update.notes = input.notes;

  // Recalcule amountHt si desks, unitPriceHt ou la période change.
  // Période × prix mensuel : un trimestre vaut 3 × mensuel.
  if (
    input.desks !== undefined ||
    input.unitPriceHt !== undefined ||
    input.periodStart !== undefined ||
    input.periodEnd !== undefined
  ) {
    const [existing] = await conn
      .select({
        desks: invoices.desks,
        unitPriceHt: invoices.unitPriceHt,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    if (existing) {
      const desks = input.desks ?? existing.desks ?? 1;
      const unit = Number(input.unitPriceHt ?? existing.unitPriceHt ?? 0);
      const periodStart = input.periodStart ?? existing.periodStart ?? "";
      const periodEnd = input.periodEnd ?? existing.periodEnd ?? "";
      const months = periodStart && periodEnd ? monthsBetween(periodStart, periodEnd) : 1;
      update.amountHt = toNumeric(desks * unit * months);
    }
  }

  await conn.update(invoices).set(update).where(eq(invoices.id, input.id));
  revalidatePath("/coworking");
  revalidatePath(`/coworking/factures/${input.id}`);
  revalidatePath("/compta");
  return { id: input.id };
});

// =====================================================================
// Lien Dougs sur une facture existante (sale invoice ou quote)
// =====================================================================

/**
 * Lie une entrée Dougs (facture OU devis) à une invoice Paradeos.
 * Auto-détecte le kind depuis l'invoice :
 *   - kind=quote → fetch quote Dougs, snapshot dans dougs_quote_id
 *   - kind=milestone | coworking | one_off → fetch sales-invoice Dougs
 */
export const linkInvoiceToDougs = action(
  z.object({
    invoiceId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    const conn = await db();
    const [inv] = await conn
      .select({
        kind: invoices.kind,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new Error("Facture Paradeos introuvable.");

    try {
      if (inv.kind === "quote") {
        const quote = await getDougsQuote(user.id, dougsId);
        await conn
          .update(invoices)
          .set({
            dougsQuoteId: dougsId,
            dougsReference: quote.reference ?? null,
            dougsStatus: pickDougsStatus(quote),
            dougsTotalHt: toNumeric(pickDougsHt(quote)),
            dougsTotalVat: toNumeric(pickDougsVat(quote)),
            dougsTotalTtc: toNumeric(pickDougsTtc(quote)),
            dougsIssuedAt: toDate(pickDougsIssuedAt(quote)),
            dougsSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
      } else {
        const inv2 = await getDougsSalesInvoice(user.id, dougsId);
        await conn
          .update(invoices)
          .set({
            dougsInvoiceId: dougsId,
            dougsReference: inv2.reference ?? null,
            dougsStatus: pickDougsStatus(inv2),
            dougsTotalHt: toNumeric(pickDougsHt(inv2)),
            dougsTotalVat: toNumeric(pickDougsVat(inv2)),
            dougsTotalTtc: toNumeric(pickDougsTtc(inv2)),
            dougsIssuedAt: toDate(pickDougsIssuedAt(inv2)),
            dougsPaidAt: toDate(pickDougsPaidAt(inv2)),
            dougsSyncedAt: new Date(),
            // Si le Dougs est payé, on remonte le statut local.
            status: pickDougsPaidAt(inv2) ? "paid" : "sent",
            invoicedAt: toDate(pickDougsIssuedAt(inv2)) ?? new Date(),
            paidAt: toDate(pickDougsPaidAt(inv2)),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
      }
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Dougs : ${err.message}`);
      }
      throw err;
    }

    revalidatePathsForInvoice(inv.projectId, inv.coworkingContractId, input.invoiceId);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

export const unlinkInvoiceDougs = action(
  z.object({ invoiceId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    const [inv] = await conn
      .select({
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new Error("Facture introuvable.");
    await conn
      .update(invoices)
      .set({
        dougsInvoiceId: null,
        dougsQuoteId: null,
        dougsReference: null,
        dougsStatus: null,
        dougsTotalHt: null,
        dougsTotalVat: null,
        dougsTotalTtc: null,
        dougsIssuedAt: null,
        dougsPaidAt: null,
        dougsSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, input.invoiceId));
    revalidatePathsForInvoice(inv.projectId, inv.coworkingContractId, input.invoiceId);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

/**
 * Refresh le snapshot Dougs d'une facture (re-fetch depuis l'API).
 */
export const refreshInvoiceDougs = action(
  z.object({ invoiceId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [inv] = await conn
      .select({
        kind: invoices.kind,
        dougsInvoiceId: invoices.dougsInvoiceId,
        dougsQuoteId: invoices.dougsQuoteId,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new Error("Facture introuvable.");

    try {
      if (inv.kind === "quote") {
        if (!inv.dougsQuoteId) throw new Error("Pas de devis Dougs lié.");
        const q = await getDougsQuote(user.id, inv.dougsQuoteId);
        await conn
          .update(invoices)
          .set({
            dougsReference: q.reference ?? null,
            dougsStatus: pickDougsStatus(q),
            dougsTotalHt: toNumeric(pickDougsHt(q)),
            dougsTotalVat: toNumeric(pickDougsVat(q)),
            dougsTotalTtc: toNumeric(pickDougsTtc(q)),
            dougsIssuedAt: toDate(pickDougsIssuedAt(q)),
            dougsSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
      } else {
        if (!inv.dougsInvoiceId) throw new Error("Pas de facture Dougs liée.");
        const i = await getDougsSalesInvoice(user.id, inv.dougsInvoiceId);
        const paid = pickDougsPaidAt(i);
        await conn
          .update(invoices)
          .set({
            dougsReference: i.reference ?? null,
            dougsStatus: pickDougsStatus(i),
            dougsTotalHt: toNumeric(pickDougsHt(i)),
            dougsTotalVat: toNumeric(pickDougsVat(i)),
            dougsTotalTtc: toNumeric(pickDougsTtc(i)),
            dougsIssuedAt: toDate(pickDougsIssuedAt(i)),
            dougsPaidAt: toDate(paid),
            dougsSyncedAt: new Date(),
            status: paid ? "paid" : "sent",
            paidAt: toDate(paid),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
      }
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Refresh Dougs : ${err.message}`);
      }
      throw err;
    }

    revalidatePathsForInvoice(inv.projectId, inv.coworkingContractId, input.invoiceId);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

/** Refresh tous les liens Dougs (devis + factures) — utilisé par le
 *  bouton "Tout rafraîchir" et le cron daily. */
export const refreshAllDougsLinks = action(z.object({}), async ({ user }) => {
  const conn = await db();
  const rows = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      dougsInvoiceId: invoices.dougsInvoiceId,
      dougsQuoteId: invoices.dougsQuoteId,
    })
    .from(invoices)
    .where(isNotNull(invoices.dougsInvoiceId));

  const quoteRows = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      dougsQuoteId: invoices.dougsQuoteId,
    })
    .from(invoices)
    .where(and(eq(invoices.kind, "quote"), isNotNull(invoices.dougsQuoteId)));

  let updated = 0;
  const errors: string[] = [];

  for (const r of rows) {
    if (!r.dougsInvoiceId) continue;
    try {
      const inv = await getDougsSalesInvoice(user.id, r.dougsInvoiceId);
      const paid = pickDougsPaidAt(inv);
      await conn
        .update(invoices)
        .set({
          dougsReference: inv.reference ?? null,
          dougsStatus: pickDougsStatus(inv),
          dougsTotalHt: toNumeric(pickDougsHt(inv)),
          dougsTotalVat: toNumeric(pickDougsVat(inv)),
          dougsTotalTtc: toNumeric(pickDougsTtc(inv)),
          dougsIssuedAt: toDate(pickDougsIssuedAt(inv)),
          dougsPaidAt: toDate(paid),
          dougsSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, r.id));
      updated++;
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      errors.push(`invoice ${r.id}: ${err instanceof Error ? err.message : "?"}`);
    }
  }

  for (const r of quoteRows) {
    if (!r.dougsQuoteId) continue;
    try {
      const q = await getDougsQuote(user.id, r.dougsQuoteId);
      await conn
        .update(invoices)
        .set({
          dougsReference: q.reference ?? null,
          dougsStatus: pickDougsStatus(q),
          dougsTotalHt: toNumeric(pickDougsHt(q)),
          dougsTotalVat: toNumeric(pickDougsVat(q)),
          dougsTotalTtc: toNumeric(pickDougsTtc(q)),
          dougsIssuedAt: toDate(pickDougsIssuedAt(q)),
          dougsSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, r.id));
      updated++;
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      errors.push(`quote ${r.id}: ${err instanceof Error ? err.message : "?"}`);
    }
  }

  revalidatePath("/compta");
  return { updated, errors };
});

// =====================================================================
// Avoirs (kind=credit_note)
// =====================================================================

/**
 * Rattache un avoir Dougs (par son ID Dougs) à la facture Dougs qu'il
 * annule. Crée la row credit_note si elle n'existe pas encore, puis
 * cascade : la facture annulée perd son lien Dougs et retourne à
 * status='draft' (elle n'est plus émise).
 */
export const linkDougsCreditNote = action(
  z.object({
    creditNoteId: z.string().min(1),
    originalInvoiceId: z.string().min(1),
  }),
  async ({ input, user }) => {
    if (input.creditNoteId === input.originalInvoiceId) {
      throw new Error("Un avoir ne peut pas s'annuler lui-même.");
    }
    const conn = await db();

    // 1. Résoudre l'invoice Paradeos qui pointe vers la facture annulée.
    const [cancelled] = await conn
      .select({
        id: invoices.id,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.dougsInvoiceId, input.originalInvoiceId))
      .limit(1);

    // 2. Find or create the credit_note invoice row.
    const [existing] = await conn
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.kind, "credit_note"), eq(invoices.dougsInvoiceId, input.creditNoteId)))
      .limit(1);

    if (existing) {
      await conn
        .update(invoices)
        .set({
          cancelsInvoiceId: cancelled?.id ?? null,
          cancelsDougsInvoiceId: input.originalInvoiceId,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, existing.id));
    } else {
      await conn.insert(invoices).values({
        kind: "credit_note",
        label: `Avoir Dougs ${input.creditNoteId.slice(0, 8)}`,
        amountHt: "0",
        status: "sent",
        dougsInvoiceId: input.creditNoteId,
        cancelsInvoiceId: cancelled?.id ?? null,
        cancelsDougsInvoiceId: input.originalInvoiceId,
        createdBy: user.id,
      });
    }

    // 3. Cascade : détache la facture annulée (status → draft, dougs_* → null).
    let detached = 0;
    if (cancelled) {
      await conn
        .update(invoices)
        .set({
          dougsInvoiceId: null,
          dougsReference: null,
          dougsStatus: null,
          dougsTotalHt: null,
          dougsTotalVat: null,
          dougsTotalTtc: null,
          dougsIssuedAt: null,
          dougsPaidAt: null,
          dougsSyncedAt: null,
          status: "draft",
          invoicedAt: null,
          paidAt: null,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, cancelled.id));
      detached = 1;
      revalidatePathsForInvoice(cancelled.projectId, cancelled.coworkingContractId, cancelled.id);
    }

    revalidatePath("/compta");
    return { ok: true as const, detached };
  },
);

export const unlinkDougsCreditNote = action(
  z.object({ creditNoteId: z.string().min(1) }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(invoices)
      .set({
        cancelsInvoiceId: null,
        cancelsDougsInvoiceId: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(invoices.kind, "credit_note"), eq(invoices.dougsInvoiceId, input.creditNoteId)),
      );
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

// =====================================================================
// Helpers internes
// =====================================================================

/** Coverage des paths Next.js qu'une mutation d'invoice doit refresh. */
function revalidatePathsForInvoice(
  projectId: string | null | undefined,
  coworkingContractId: string | null | undefined,
  _invoiceId: string,
) {
  if (projectId) {
    revalidatePath(`/projets/${projectId}`);
  }
  if (coworkingContractId) {
    revalidatePath(`/coworking/contrats/${coworkingContractId}`);
    revalidatePath("/coworking");
  }
}

// =====================================================================
// "Création depuis Dougs" — utilisés par le rapprochement quand on
// rencontre une facture Dougs qui n'a pas d'équivalent local.
// =====================================================================

/**
 * Lie une facture Dougs existante à un projet en créant un nouveau jalon
 * milestone à la volée. `detectedPercent` permet de typer (acompte 40 %,
 * solde 60 %, etc.) et de générer un label cohérent.
 */
export const linkProjectAsNewMilestone = action(
  z.object({
    projectId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
    detectedPercent: z.number().int().min(0).max(100).nullable(),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    const conn = await db();
    const [proj] = await conn
      .select({ id: projects.id, kind: projects.kind })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!proj) throw new Error("Projet introuvable.");

    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Facture Dougs : ${err.message}`);
      }
      throw err;
    }

    const dougsAmount = pickDougsHt(invoice) ?? pickDougsTtc(invoice);
    if (typeof dougsAmount !== "number") {
      throw new Error("Montant facture inconnu.");
    }

    const pct = input.detectedPercent;
    let label: string;
    let mType: "acompte" | "intermediaire" | "solde";
    if (pct != null && pct < 50) {
      mType = "acompte";
      label = `Acompte ${pct} %`;
    } else if (pct != null && pct >= 95) {
      mType = "solde";
      label = "Solde 100 %";
    } else if (pct != null && pct > 50) {
      mType = "solde";
      label = `Solde ${pct} %`;
    } else {
      mType = "intermediaire";
      label = invoice.reference ? `Facture ${invoice.reference}` : "Facture";
    }

    const paid = pickDougsPaidAt(invoice);
    const [row] = await conn
      .insert(invoices)
      .values({
        kind: "milestone",
        projectId: input.projectId,
        label,
        amountHt: toNumeric(Math.round(dougsAmount * 100) / 100) ?? "0",
        vatRate: "0.2",
        status: paid ? "paid" : "sent",
        milestoneType: mType,
        milestonePercent: pct,
        invoicedAt: toDate(pickDougsIssuedAt(invoice)) ?? new Date(),
        paidAt: toDate(paid),
        dougsInvoiceId: dougsId,
        dougsReference: invoice.reference ?? null,
        dougsStatus: pickDougsStatus(invoice),
        dougsTotalHt: toNumeric(pickDougsHt(invoice)),
        dougsTotalVat: toNumeric(pickDougsVat(invoice)),
        dougsTotalTtc: toNumeric(pickDougsTtc(invoice)),
        dougsIssuedAt: toDate(pickDougsIssuedAt(invoice)),
        dougsPaidAt: toDate(paid),
        dougsSyncedAt: new Date(),
        createdBy: user.id,
      })
      .returning({ id: invoices.id });

    revalidatePath(`/projets/${input.projectId}`);
    revalidatePath("/compta");
    return {
      reference: invoice.reference ?? null,
      milestoneLabel: label,
      milestoneId: row?.id ?? "",
    };
  },
);

/**
 * Lie une facture Dougs existante à un contrat coworking en créant
 * une nouvelle facture coworking à la volée (avec une période déduite
 * de la date de la facture Dougs).
 */
export const linkCoworkingContractAsNewInvoice = action(
  z.object({
    contractId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    const conn = await db();
    const [contract] = await conn
      .select({
        id: coworkingContracts.id,
        name: coworkingContracts.name,
        desks: coworkingContracts.desks,
        unitPriceHt: coworkingContracts.unitPriceHt,
        billingFrequency: coworkingContracts.billingFrequency,
      })
      .from(coworkingContracts)
      .where(eq(coworkingContracts.id, input.contractId))
      .limit(1);
    if (!contract) throw new Error("Contrat coworking introuvable.");

    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Facture Dougs : ${err.message}`);
      }
      throw err;
    }

    // Période déduite de la date Dougs (ou aujourd'hui à défaut).
    const issuedRaw = pickDougsIssuedAt(invoice);
    const dougsDate = issuedRaw ? new Date(issuedRaw) : new Date();
    if (Number.isNaN(dougsDate.getTime())) {
      throw new Error("Date Dougs invalide.");
    }
    const periodStart = new Date(dougsDate.getFullYear(), dougsDate.getMonth(), 1);
    const periodEnd = new Date(
      dougsDate.getFullYear(),
      dougsDate.getMonth() + (contract.billingFrequency === "quarterly" ? 3 : 1),
      0,
    );
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const periodStartStr = toISO(periodStart);
    const periodEndStr = toISO(periodEnd);

    const paid = pickDougsPaidAt(invoice);
    const months = contract.billingFrequency === "quarterly" ? 3 : 1;
    const amountHt = Number(contract.unitPriceHt) * contract.desks * months;

    const [row] = await conn
      .insert(invoices)
      .values({
        kind: "coworking",
        coworkingContractId: contract.id,
        label: `${contract.name} — ${periodStartStr.slice(0, 7)}`,
        amountHt: toNumeric(amountHt) ?? "0",
        vatRate: "0.2",
        status: paid ? "paid" : "sent",
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        desks: contract.desks,
        unitPriceHt: contract.unitPriceHt,
        billedBy: "parade",
        invoicedAt: toDate(issuedRaw) ?? new Date(),
        paidAt: toDate(paid),
        dougsInvoiceId: dougsId,
        dougsReference: invoice.reference ?? null,
        dougsStatus: pickDougsStatus(invoice),
        dougsTotalHt: toNumeric(pickDougsHt(invoice)),
        dougsTotalVat: toNumeric(pickDougsVat(invoice)),
        dougsTotalTtc: toNumeric(pickDougsTtc(invoice)),
        dougsIssuedAt: toDate(issuedRaw),
        dougsPaidAt: toDate(paid),
        dougsSyncedAt: new Date(),
        createdBy: user.id,
      })
      .returning({ id: invoices.id });

    revalidatePath(`/coworking/contrats/${contract.id}`);
    revalidatePath("/coworking");
    revalidatePath("/compta");
    return { reference: invoice.reference ?? null, invoiceId: row?.id ?? "" };
  },
);

/**
 * Lie un devis Dougs à un projet : crée la quote invoice si elle
 * n'existe pas encore, sinon update le lien.
 */
export const linkProjectQuoteToDougs = action(
  z.object({
    projectId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    const conn = await db();

    let quote: Awaited<ReturnType<typeof getDougsQuote>>;
    try {
      quote = await getDougsQuote(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Devis Dougs : ${err.message}`);
      }
      throw err;
    }

    const [existing] = await conn
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.projectId, input.projectId), eq(invoices.kind, "quote")))
      .limit(1);

    const snap = {
      dougsQuoteId: dougsId,
      dougsReference: quote.reference ?? null,
      dougsStatus: pickDougsStatus(quote),
      dougsTotalHt: toNumeric(pickDougsHt(quote)),
      dougsTotalVat: toNumeric(pickDougsVat(quote)),
      dougsTotalTtc: toNumeric(pickDougsTtc(quote)),
      dougsIssuedAt: toDate(pickDougsIssuedAt(quote)),
      dougsSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      await conn.update(invoices).set(snap).where(eq(invoices.id, existing.id));
    } else {
      const [proj] = await conn
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!proj) throw new Error("Projet introuvable.");
      await conn.insert(invoices).values({
        kind: "quote",
        projectId: input.projectId,
        label: `Devis ${proj.name}`,
        amountHt: toNumeric(pickDougsHt(quote)) ?? "0",
        vatRate: "0.2",
        status: "sent",
        ...snap,
        createdBy: user.id,
      });
    }

    revalidatePath(`/projets/${input.projectId}`);
    revalidatePath("/compta");
    return { reference: quote.reference ?? null };
  },
);

/**
 * Transfère le lien Dougs d'une invoice vers une autre. Utilisé pour
 * "changer la cible" depuis la section "Déjà rattachés". Garde le
 * snapshot intact, juste change la row qui le porte.
 */
export const moveInvoiceDougsLink = action(
  z.object({
    fromInvoiceId: z.string().uuid(),
    toInvoiceId: z.string().uuid(),
  }),
  async ({ input }) => {
    if (input.fromInvoiceId === input.toInvoiceId) {
      throw new Error("Source et cible identiques.");
    }
    const conn = await db();
    const [from] = await conn
      .select({
        kind: invoices.kind,
        dougsInvoiceId: invoices.dougsInvoiceId,
        dougsQuoteId: invoices.dougsQuoteId,
        dougsReference: invoices.dougsReference,
        dougsStatus: invoices.dougsStatus,
        dougsTotalHt: invoices.dougsTotalHt,
        dougsTotalVat: invoices.dougsTotalVat,
        dougsTotalTtc: invoices.dougsTotalTtc,
        dougsIssuedAt: invoices.dougsIssuedAt,
        dougsPaidAt: invoices.dougsPaidAt,
        dougsSyncedAt: invoices.dougsSyncedAt,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.fromInvoiceId))
      .limit(1);
    if (!from) throw new Error("Facture source introuvable.");
    if (!from.dougsInvoiceId && !from.dougsQuoteId) {
      throw new Error("Aucun lien Dougs sur la facture source.");
    }

    const [to] = await conn
      .select({
        dougsInvoiceId: invoices.dougsInvoiceId,
        dougsQuoteId: invoices.dougsQuoteId,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.toInvoiceId))
      .limit(1);
    if (!to) throw new Error("Facture cible introuvable.");
    if (to.dougsInvoiceId || to.dougsQuoteId) {
      throw new Error("La facture cible a déjà un lien Dougs.");
    }

    await conn
      .update(invoices)
      .set({
        dougsInvoiceId: from.dougsInvoiceId,
        dougsQuoteId: from.dougsQuoteId,
        dougsReference: from.dougsReference,
        dougsStatus: from.dougsStatus,
        dougsTotalHt: from.dougsTotalHt,
        dougsTotalVat: from.dougsTotalVat,
        dougsTotalTtc: from.dougsTotalTtc,
        dougsIssuedAt: from.dougsIssuedAt,
        dougsPaidAt: from.dougsPaidAt,
        dougsSyncedAt: from.dougsSyncedAt,
        // Si le lien Dougs est "payé", on remonte au moins à "sent".
        // Le statut local de la cible peut rester paid si déjà à paid.
        status: from.dougsPaidAt ? "paid" : "sent",
        invoicedAt: from.dougsIssuedAt ?? new Date(),
        paidAt: from.dougsPaidAt,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, input.toInvoiceId));

    await conn
      .update(invoices)
      .set({
        dougsInvoiceId: null,
        dougsQuoteId: null,
        dougsReference: null,
        dougsStatus: null,
        dougsTotalHt: null,
        dougsTotalVat: null,
        dougsTotalTtc: null,
        dougsIssuedAt: null,
        dougsPaidAt: null,
        dougsSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, input.fromInvoiceId));

    revalidatePathsForInvoice(from.projectId, from.coworkingContractId, input.fromInvoiceId);
    revalidatePathsForInvoice(to.projectId, to.coworkingContractId, input.toInvoiceId);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

// Re-export utilitaire utilisé par d'autres lib (push devis depuis un projet, etc.).
export { extractDougsUuid };
