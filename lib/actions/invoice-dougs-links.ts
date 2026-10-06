"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { revalidatePathsForInvoice } from "@/lib/actions/invoice-helpers";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import {
  extractDougsUuid,
  isDougsInvoicePaid,
  mapDougsQuoteStatus,
  toDate,
  toNumeric,
} from "@/lib/billing/invoice-lifecycle";
import {
  coworkingInvoiceAmountHt,
  coworkingPeriodFromDate,
  milestoneFromDetectedPercent,
} from "@/lib/billing/milestones-math";
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
            // Si le Dougs est payé (statut « paid » OU date de paiement),
            // on remonte le statut local — même règle que le refresh.
            status: isDougsInvoicePaid(pickDougsStatus(inv2), pickDougsPaidAt(inv2))
              ? "paid"
              : "sent",
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
        const dougsStatus = pickDougsStatus(q);
        await conn
          .update(invoices)
          .set({
            dougsReference: q.reference ?? null,
            dougsStatus,
            dougsTotalHt: toNumeric(pickDougsHt(q)),
            dougsTotalVat: toNumeric(pickDougsVat(q)),
            dougsTotalTtc: toNumeric(pickDougsTtc(q)),
            dougsIssuedAt: toDate(pickDougsIssuedAt(q)),
            dougsSyncedAt: new Date(),
            // Sync status local depuis Dougs (ACCEPTED → accepted, etc.).
            status: mapDougsQuoteStatus(dougsStatus),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
      } else {
        if (!inv.dougsInvoiceId) throw new Error("Pas de facture Dougs liée.");
        const i = await getDougsSalesInvoice(user.id, inv.dougsInvoiceId);
        const paid = pickDougsPaidAt(i);
        const dougsStatus = pickDougsStatus(i);
        const isPaidDougs = isDougsInvoicePaid(dougsStatus, paid);
        await conn
          .update(invoices)
          .set({
            dougsReference: i.reference ?? null,
            dougsStatus,
            dougsTotalHt: toNumeric(pickDougsHt(i)),
            dougsTotalVat: toNumeric(pickDougsVat(i)),
            dougsTotalTtc: toNumeric(pickDougsTtc(i)),
            dougsIssuedAt: toDate(pickDougsIssuedAt(i)),
            dougsPaidAt: toDate(paid),
            dougsSyncedAt: new Date(),
            // Dougs paymentStatus="paid" OU paidAt présent → on bascule.
            status: isPaidDougs ? "paid" : "sent",
            // Dougs est source de vérité pour paid_at.
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

    // Bust le tag spécifique du Dougs entry pour que les caches détail
    // (cachedGetDougsSalesInvoice / cachedGetDougsQuote) renvoient frais.
    if (inv.dougsInvoiceId) revalidateTag(`dougs-invoice:${inv.dougsInvoiceId}`, { expire: 0 });
    if (inv.dougsQuoteId) revalidateTag(`dougs-quote:${inv.dougsQuoteId}`, { expire: 0 });
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
      const dougsStatus = pickDougsStatus(inv);
      const isPaidDougs = isDougsInvoicePaid(dougsStatus, paid);
      await conn
        .update(invoices)
        .set({
          dougsReference: inv.reference ?? null,
          dougsStatus,
          dougsTotalHt: toNumeric(pickDougsHt(inv)),
          dougsTotalVat: toNumeric(pickDougsVat(inv)),
          dougsTotalTtc: toNumeric(pickDougsTtc(inv)),
          dougsIssuedAt: toDate(pickDougsIssuedAt(inv)),
          dougsPaidAt: toDate(paid),
          dougsSyncedAt: new Date(),
          // Sync status local : Dougs source de vérité pour "payé".
          status: isPaidDougs ? "paid" : undefined,
          paidAt: isPaidDougs ? toDate(paid) : undefined,
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
      const dougsStatus = pickDougsStatus(q);
      await conn
        .update(invoices)
        .set({
          dougsReference: q.reference ?? null,
          dougsStatus,
          dougsTotalHt: toNumeric(pickDougsHt(q)),
          dougsTotalVat: toNumeric(pickDougsVat(q)),
          dougsTotalTtc: toNumeric(pickDougsTtc(q)),
          dougsIssuedAt: toDate(pickDougsIssuedAt(q)),
          dougsSyncedAt: new Date(),
          // Sync status local depuis Dougs (ACCEPTED → accepted, etc.).
          status: mapDougsQuoteStatus(dougsStatus),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, r.id));
      updated++;
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      errors.push(`quote ${r.id}: ${err instanceof Error ? err.message : "?"}`);
    }
  }

  // Bust le cache Dougs (lib/dougs/cache.ts) pour que la prochaine
  // visite voie les statuts/montants fraîchement synchronisés.
  revalidateTag(`dougs:${user.id}`, { expire: 0 });
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
        brand: invoices.brand,
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
        // Un avoir relève de la marque de la facture qu'il annule ; faute de
        // facture Paradeos correspondante, il retombe sur le fourre-tout.
        brand: cancelled?.brand ?? "parade",
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

    // Un 50 % est un acompte si le projet n'en a pas encore, un solde sinon.
    const [existingAcompte] = await conn
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.projectId, input.projectId),
          eq(invoices.kind, "milestone"),
          eq(invoices.milestoneType, "acompte"),
        ),
      )
      .limit(1);
    const {
      milestoneType: mType,
      label,
      milestonePercent,
    } = milestoneFromDetectedPercent(input.detectedPercent, invoice.reference ?? null, {
      hasAcompte: existingAcompte !== undefined,
    });

    const paid = pickDougsPaidAt(invoice);
    const [row] = await conn
      .insert(invoices)
      .values({
        kind: "milestone",
        brand: "automato",
        projectId: input.projectId,
        label,
        amountHt: toNumeric(Math.round(dougsAmount * 100) / 100) ?? "0",
        vatRate: brandTemplateFor("automato").defaultVatRate.toString(),
        status: isDougsInvoicePaid(pickDougsStatus(invoice), paid) ? "paid" : "sent",
        milestoneType: mType,
        milestonePercent,
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
    const {
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      months,
    } = coworkingPeriodFromDate(dougsDate, contract.billingFrequency);

    const paid = pickDougsPaidAt(invoice);
    const amountHt = coworkingInvoiceAmountHt(contract.desks, Number(contract.unitPriceHt), months);

    const [row] = await conn
      .insert(invoices)
      .values({
        kind: "coworking",
        brand: "coworking",
        coworkingContractId: contract.id,
        label: `${contract.name} — ${periodStartStr.slice(0, 7)}`,
        amountHt: toNumeric(amountHt) ?? "0",
        vatRate: brandTemplateFor("coworking").defaultVatRate.toString(),
        status: isDougsInvoicePaid(pickDougsStatus(invoice), paid) ? "paid" : "sent",
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

    const dougsStatus = pickDougsStatus(quote);
    const localStatus = mapDougsQuoteStatus(dougsStatus);
    const snap = {
      dougsQuoteId: dougsId,
      dougsReference: quote.reference ?? null,
      dougsStatus,
      dougsTotalHt: toNumeric(pickDougsHt(quote)),
      dougsTotalVat: toNumeric(pickDougsVat(quote)),
      dougsTotalTtc: toNumeric(pickDougsTtc(quote)),
      dougsIssuedAt: toDate(pickDougsIssuedAt(quote)),
      dougsSyncedAt: new Date(),
      // On aligne le status local au status Dougs dès le link
      // (avant : forcé à 'sent', donc un devis déjà ACCEPTED côté
      // Dougs restait 'sent' jusqu'au prochain cron quotidien).
      status: localStatus,
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
        brand: "automato",
        projectId: input.projectId,
        label: `Devis ${proj.name}`,
        amountHt: toNumeric(pickDougsHt(quote)) ?? "0",
        vatRate: brandTemplateFor("automato").defaultVatRate.toString(),
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
        // Si le lien Dougs est payé (statut ou date), la cible passe à
        // "paid", sinon au moins à "sent".
        status: isDougsInvoicePaid(from.dougsStatus, from.dougsPaidAt) ? "paid" : "sent",
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
