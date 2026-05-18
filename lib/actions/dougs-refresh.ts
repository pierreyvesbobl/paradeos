"use server";

import { randomUUID } from "node:crypto";
import { coworkingContracts, coworkingInvoices } from "@/db/schema/coworking";
import { type BillingMilestone, projects } from "@/db/schema/projects";
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
import { eq } from "drizzle-orm";
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

/**
 * Accepte un UUID brut OU une URL Dougs et renvoie l'UUID extrait.
 * Throw si pas reconnaissable. Couvre :
 *   - "abc-def-..." (UUID nu)
 *   - "https://app.dougs.fr/app/c/107610/invoicing/quotes/{uuid}"
 *   - "https://app.dougs.fr/app/c/107610/invoicing/sales-invoices/{uuid}"
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function extractDougsUuid(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(UUID_RE);
  if (!match) {
    throw new Error(
      "ID Dougs introuvable. Colle un UUID ou une URL Dougs (.../invoicing/quotes/{uuid} ou /sales-invoices/{uuid}).",
    );
  }
  return match[0];
}

/**
 * Refetch un devis Dougs et update le snapshot stocké sur le projet
 * (référence, statut, totaux, date d'émission).
 */
export const refreshProjectDougsQuote = action(
  z.object({ projectId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [row] = await conn
      .select({ dougsQuoteId: projects.dougsQuoteId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!row?.dougsQuoteId) {
      throw new Error("Pas de devis Dougs lié à ce projet.");
    }

    let quote: Awaited<ReturnType<typeof getDougsQuote>>;
    try {
      quote = await getDougsQuote(user.id, row.dougsQuoteId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Refresh Dougs : ${err.message}`);
      }
      throw err;
    }

    await conn
      .update(projects)
      .set({
        dougsQuoteReference: quote.reference ?? null,
        dougsQuoteStatus: pickDougsStatus(quote),
        dougsQuoteTotalHt: toNumeric(pickDougsHt(quote)),
        dougsQuoteTotalVat: toNumeric(pickDougsVat(quote)),
        dougsQuoteTotalTtc: toNumeric(pickDougsTtc(quote)),
        dougsQuoteIssuedAt: toDate(pickDougsIssuedAt(quote)),
        dougsQuoteSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: quote.reference ?? null,
      status: pickDougsStatus(quote),
      totalTtc: pickDougsTtc(quote),
    };
  },
);

/**
 * Refetch une facture Dougs liée à un jalon de facturation et update
 * le jalon dans le JSONB projects.billing_milestones.
 */
export const refreshProjectMilestoneDougsInvoice = action(
  z.object({ projectId: z.string().uuid(), milestoneId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [row] = await conn
      .select({ billingMilestones: projects.billingMilestones })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!row) throw new Error("Projet introuvable.");

    const milestones = (row.billingMilestones ?? []) as BillingMilestone[];
    const idx = milestones.findIndex((m) => m.id === input.milestoneId);
    if (idx === -1) throw new Error("Jalon introuvable.");
    const milestone = milestones[idx];
    if (!milestone?.dougsInvoiceId) {
      throw new Error("Pas de facture Dougs liée à ce jalon.");
    }

    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, milestone.dougsInvoiceId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Refresh Dougs : ${err.message}`);
      }
      throw err;
    }

    const paidAt = pickDougsPaidAt(invoice);
    const next = [...milestones];
    next[idx] = {
      ...milestone,
      dougsInvoiceReference: invoice.reference ?? milestone.dougsInvoiceReference,
      dougsStatus: pickDougsStatus(invoice),
      dougsTotalHt: pickDougsHt(invoice),
      dougsTotalVat: pickDougsVat(invoice),
      dougsTotalTtc: pickDougsTtc(invoice),
      dougsIssuedAt: pickDougsIssuedAt(invoice),
      dougsSyncedAt: new Date().toISOString(),
      paidAt: paidAt ?? milestone.paidAt,
      status: paidAt && milestone.status !== "paid" ? "paid" : milestone.status,
    };

    await conn
      .update(projects)
      .set({ billingMilestones: next, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: invoice.reference ?? null,
      status: pickDougsStatus(invoice),
      paidAt,
    };
  },
);

/**
 * Lie un devis Dougs existant (créé manuellement dans Dougs ou ailleurs)
 * à un projet Paradeos. Accepte URL ou UUID, vérifie l'existence via
 * getDougsQuote, stocke le lien et pré-remplit le snapshot dans la
 * foulée.
 */
export const linkProjectDougsQuote = action(
  z.object({
    projectId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    let quote: Awaited<ReturnType<typeof getDougsQuote>>;
    try {
      quote = await getDougsQuote(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Devis Dougs introuvable : ${err.message}`);
      }
      throw err;
    }

    const conn = await db();
    await conn
      .update(projects)
      .set({
        dougsQuoteId: dougsId,
        dougsQuoteReference: quote.reference ?? null,
        dougsQuoteStatus: pickDougsStatus(quote),
        dougsQuoteTotalHt: toNumeric(pickDougsHt(quote)),
        dougsQuoteTotalVat: toNumeric(pickDougsVat(quote)),
        dougsQuoteTotalTtc: toNumeric(pickDougsTtc(quote)),
        dougsQuoteIssuedAt: toDate(pickDougsIssuedAt(quote)),
        dougsQuotePushedAt: new Date(),
        dougsQuoteSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: quote.reference ?? null,
      status: pickDougsStatus(quote),
    };
  },
);

/**
 * Lie une facture Dougs existante à un projet en CRÉANT un nouveau jalon
 * à la volée. Utilisé quand la facture est probablement un acompte ou
 * un solde d'un projet sans jalon préexistant.
 *
 * Le jalon est créé en statut `invoiced`, avec :
 *  - amountHt = montant Dougs
 *  - percent = ratio facture / valueAmount projet (si projet a un montant)
 *  - type = inférré du % (acompte si < 50, solde si > 50, intermediaire sinon)
 *  - label = "Acompte XX %" / "Solde XX %" / "Facture"
 */
export const linkProjectAsNewMilestone = action(
  z.object({
    projectId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
    /** % détecté côté UI (optionnel — sinon recalculé serveur). */
    detectedPercent: z.number().min(0).max(150).nullable().optional(),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Facture Dougs introuvable : ${err.message}`);
      }
      throw err;
    }

    const conn = await db();
    const [project] = await conn
      .select({
        id: projects.id,
        valueAmount: projects.valueAmount,
        budgetAmount: projects.budgetAmount,
        billingMilestones: projects.billingMilestones,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new Error("Projet introuvable.");

    const invoiceAmount = pickDougsHt(invoice) ?? pickDougsTtc(invoice) ?? 0;
    if (invoiceAmount <= 0) throw new Error("Montant facture inconnu.");

    const projectValueHt = Number(project.valueAmount ?? project.budgetAmount ?? 0);
    const computedPercent =
      input.detectedPercent ??
      (projectValueHt > 0 ? Math.round((invoiceAmount / projectValueHt) * 100) : null);

    // Type & label inférés.
    let type: "acompte" | "intermediaire" | "solde";
    let label: string;
    if (computedPercent != null) {
      if (computedPercent < 50) {
        type = "acompte";
        label = `Acompte ${computedPercent} %`;
      } else if (computedPercent >= 95) {
        type = "solde";
        label = "Solde 100 %";
      } else if (computedPercent > 50) {
        type = "solde";
        label = `Solde ${computedPercent} %`;
      } else {
        type = "intermediaire";
        label = "Intermédiaire 50 %";
      }
    } else {
      type = "intermediaire";
      label = invoice.reference ? `Facture ${invoice.reference}` : "Facture";
    }

    const milestones = (project.billingMilestones ?? []) as BillingMilestone[];
    const newMilestone: BillingMilestone = {
      id: randomUUID(),
      type,
      label,
      percent: computedPercent,
      amountHt: Math.round(invoiceAmount * 100) / 100,
      vatRate: 0.2,
      status: pickDougsPaidAt(invoice) ? "paid" : "invoiced",
      dougsInvoiceId: dougsId,
      dougsInvoiceReference: invoice.reference ?? null,
      invoicedAt: pickDougsIssuedAt(invoice) ?? new Date().toISOString(),
      paidAt: pickDougsPaidAt(invoice),
      dougsStatus: pickDougsStatus(invoice),
      dougsTotalHt: pickDougsHt(invoice),
      dougsTotalVat: pickDougsVat(invoice),
      dougsTotalTtc: pickDougsTtc(invoice),
      dougsIssuedAt: pickDougsIssuedAt(invoice),
      dougsSyncedAt: new Date().toISOString(),
    };

    await conn
      .update(projects)
      .set({ billingMilestones: [...milestones, newMilestone], updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    revalidatePath("/rapprochement");
    return {
      reference: invoice.reference ?? null,
      milestoneLabel: label,
      milestoneId: newMilestone.id,
    };
  },
);

/**
 * Lie une facture Dougs existante à un jalon de facturation.
 */
export const linkProjectMilestoneDougsInvoice = action(
  z.object({
    projectId: z.string().uuid(),
    milestoneId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Facture Dougs introuvable : ${err.message}`);
      }
      throw err;
    }

    const conn = await db();
    const [row] = await conn
      .select({ billingMilestones: projects.billingMilestones })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!row) throw new Error("Projet introuvable.");

    const milestones = (row.billingMilestones ?? []) as BillingMilestone[];
    const idx = milestones.findIndex((m) => m.id === input.milestoneId);
    if (idx === -1) throw new Error("Jalon introuvable.");
    const milestone = milestones[idx];
    if (!milestone) throw new Error("Jalon introuvable.");

    const next = [...milestones];
    next[idx] = {
      ...milestone,
      dougsInvoiceId: dougsId,
      dougsInvoiceReference: invoice.reference ?? null,
      dougsStatus: pickDougsStatus(invoice),
      dougsTotalHt: pickDougsHt(invoice),
      dougsTotalVat: pickDougsVat(invoice),
      dougsTotalTtc: pickDougsTtc(invoice),
      dougsIssuedAt: pickDougsIssuedAt(invoice),
      dougsSyncedAt: new Date().toISOString(),
      invoicedAt: milestone.invoicedAt ?? new Date().toISOString(),
      paidAt: pickDougsPaidAt(invoice) ?? milestone.paidAt,
      status: pickDougsPaidAt(invoice)
        ? "paid"
        : milestone.status === "todo"
          ? "invoiced"
          : milestone.status,
    };

    await conn
      .update(projects)
      .set({ billingMilestones: next, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: invoice.reference ?? null,
      status: pickDougsStatus(invoice),
    };
  },
);

/**
 * Lie une facture Dougs existante à une facture coworking.
 */
/**
 * Lie une facture Dougs à un CONTRAT coworking sans facture Paradeos
 * pré-existante : crée une coworking_invoice à la volée pour le contrat
 * avec une période déduite de la date de la facture Dougs (ou de la
 * date d'aujourd'hui à défaut), puis attache le lien Dougs.
 *
 * Période par défaut :
 *   - trimestriel  : du 1er du mois de la facture au dernier jour du
 *                    mois +2 (3 mois)
 *   - mensuel      : du 1er au dernier jour du mois de la facture
 */
export const linkCoworkingContractAsNewInvoice = action(
  z.object({
    contractId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Facture Dougs introuvable : ${err.message}`);
      }
      throw err;
    }

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

    // Période déduite de la date Dougs (issuedAt → createdAt → today).
    const dougsDateStr =
      pickDougsIssuedAt(invoice) ??
      (invoice as { createdAt?: string }).createdAt ??
      new Date().toISOString();
    const dougsDate = new Date(dougsDateStr);
    const monthsInPeriod = contract.billingFrequency === "quarterly" ? 3 : 1;
    const periodStart = new Date(dougsDate.getFullYear(), dougsDate.getMonth(), 1);
    const periodEnd = new Date(dougsDate.getFullYear(), dougsDate.getMonth() + monthsInPeriod, 0);
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const periodStartStr = toISO(periodStart);
    const periodEndStr = toISO(periodEnd);
    const invoiceDateStr = toISO(dougsDate);

    const status: "envoyee" | "payee" = pickDougsPaidAt(invoice) ? "payee" : "envoyee";
    const paidAt = pickDougsPaidAt(invoice);

    const [newInv] = await conn
      .insert(coworkingInvoices)
      .values({
        contractId: contract.id,
        name: `${contract.name} — ${periodStartStr.slice(0, 7)}`,
        invoiceDate: invoiceDateStr,
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        status,
        billedBy: "parade",
        desks: contract.desks,
        unitPriceHt: contract.unitPriceHt,
        vatRate: "0.2",
        notes: null,
        dougsInvoiceId: dougsId,
        dougsInvoiceReference: invoice.reference ?? null,
        dougsInvoiceStatus: pickDougsStatus(invoice),
        dougsInvoiceTotalHt: toNumeric(pickDougsHt(invoice)),
        dougsInvoiceTotalVat: toNumeric(pickDougsVat(invoice)),
        dougsInvoiceTotalTtc: toNumeric(pickDougsTtc(invoice)),
        dougsInvoiceIssuedAt: toDate(pickDougsIssuedAt(invoice)),
        dougsInvoicePaidAt: toDate(paidAt),
        dougsInvoiceSyncedAt: new Date(),
        createdBy: user.id,
      })
      .returning({ id: coworkingInvoices.id });

    revalidatePath("/coworking");
    revalidatePath("/rapprochement");
    return {
      coworkingInvoiceId: newInv?.id ?? null,
      reference: invoice.reference ?? null,
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
    };
  },
);

export const linkCoworkingInvoiceDougs = action(
  z.object({
    coworkingInvoiceId: z.string().uuid(),
    dougsIdOrUrl: z.string().trim().min(1),
  }),
  async ({ input, user }) => {
    const dougsId = extractDougsUuid(input.dougsIdOrUrl);
    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, dougsId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Facture Dougs introuvable : ${err.message}`);
      }
      throw err;
    }

    const conn = await db();
    const [row] = await conn
      .select({ status: coworkingInvoices.status })
      .from(coworkingInvoices)
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId))
      .limit(1);
    if (!row) throw new Error("Facture coworking introuvable.");

    const paidAt = pickDougsPaidAt(invoice);
    const localStatus =
      paidAt && row.status !== "payee"
        ? ("payee" as const)
        : row.status === "a_facturer"
          ? ("envoyee" as const)
          : row.status;

    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceId: dougsId,
        dougsInvoiceReference: invoice.reference ?? null,
        dougsInvoiceStatus: pickDougsStatus(invoice),
        dougsInvoiceTotalHt: toNumeric(pickDougsHt(invoice)),
        dougsInvoiceTotalVat: toNumeric(pickDougsVat(invoice)),
        dougsInvoiceTotalTtc: toNumeric(pickDougsTtc(invoice)),
        dougsInvoiceIssuedAt: toDate(pickDougsIssuedAt(invoice)),
        dougsInvoicePaidAt: toDate(paidAt),
        dougsInvoiceSyncedAt: new Date(),
        status: localStatus,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId));

    revalidatePath(`/coworking/factures/${input.coworkingInvoiceId}`);
    revalidatePath("/coworking");
    return {
      reference: invoice.reference ?? null,
      status: pickDougsStatus(invoice),
    };
  },
);

/**
 * Refetch la facture Dougs liée à une facture coworking et update les
 * champs de synchronisation sur coworking_invoices.
 */
export const refreshCoworkingInvoiceDougs = action(
  z.object({ coworkingInvoiceId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [row] = await conn
      .select({
        dougsInvoiceId: coworkingInvoices.dougsInvoiceId,
        status: coworkingInvoices.status,
      })
      .from(coworkingInvoices)
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId))
      .limit(1);
    if (!row?.dougsInvoiceId) {
      throw new Error("Pas de facture Dougs liée.");
    }

    let invoice: Awaited<ReturnType<typeof getDougsSalesInvoice>>;
    try {
      invoice = await getDougsSalesInvoice(user.id, row.dougsInvoiceId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Refresh Dougs : ${err.message}`);
      }
      throw err;
    }

    // Si Dougs dit que c'est payé, on aligne le statut local. On garde
    // `envoyee` si Dougs renvoie autre chose qu'un paiement, pour ne pas
    // écraser une décision humaine.
    const paidAt = pickDougsPaidAt(invoice);
    const localStatus = paidAt && row.status !== "payee" ? ("payee" as const) : row.status;

    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceReference: invoice.reference ?? null,
        dougsInvoiceStatus: pickDougsStatus(invoice),
        dougsInvoiceTotalHt: toNumeric(pickDougsHt(invoice)),
        dougsInvoiceTotalVat: toNumeric(pickDougsVat(invoice)),
        dougsInvoiceTotalTtc: toNumeric(pickDougsTtc(invoice)),
        dougsInvoiceIssuedAt: toDate(pickDougsIssuedAt(invoice)),
        dougsInvoicePaidAt: toDate(paidAt),
        dougsInvoiceSyncedAt: new Date(),
        status: localStatus,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId));

    revalidatePath(`/coworking/factures/${input.coworkingInvoiceId}`);
    revalidatePath("/coworking");
    return {
      reference: invoice.reference ?? null,
      status: pickDougsStatus(invoice),
      paidAt,
    };
  },
);

/**
 * Refresh tous les liens Dougs du user courant : devis projet non
 * REFUSED, jalons facturés non payés, factures coworking non payées.
 * Réutilise la logique du cron mais déclenchable depuis l'UI.
 */
export const refreshAllDougsLinks = action(z.object({}), async ({ user }) => {
  const conn = await db();
  let quotesUpdated = 0;
  let milestonesUpdated = 0;
  let coworkingUpdated = 0;
  const errors: string[] = [];

  const projectRows = await conn
    .select({
      id: projects.id,
      dougsQuoteId: projects.dougsQuoteId,
      dougsQuoteStatus: projects.dougsQuoteStatus,
      billingMilestones: projects.billingMilestones,
    })
    .from(projects);

  for (const p of projectRows) {
    if (p.dougsQuoteId && p.dougsQuoteStatus !== "REFUSED") {
      try {
        const quote = await getDougsQuote(user.id, p.dougsQuoteId);
        await conn
          .update(projects)
          .set({
            dougsQuoteReference: quote.reference ?? null,
            dougsQuoteStatus: pickDougsStatus(quote),
            dougsQuoteTotalHt: toNumeric(pickDougsHt(quote)),
            dougsQuoteTotalVat: toNumeric(pickDougsVat(quote)),
            dougsQuoteTotalTtc: toNumeric(pickDougsTtc(quote)),
            dougsQuoteIssuedAt: toDate(pickDougsIssuedAt(quote)),
            dougsQuoteSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id));
        quotesUpdated++;
      } catch (err) {
        if (err instanceof DougsAuthError) throw err;
        errors.push(`devis ${p.id}: ${err instanceof Error ? err.message : "?"}`);
      }
    }

    const milestones = (p.billingMilestones ?? []) as BillingMilestone[];
    let changed = false;
    const next: BillingMilestone[] = [];
    for (const m of milestones) {
      if (m.dougsInvoiceId && m.status !== "paid") {
        try {
          const inv = await getDougsSalesInvoice(user.id, m.dougsInvoiceId);
          const paidAt = pickDougsPaidAt(inv);
          milestonesUpdated++;
          changed = true;
          next.push({
            ...m,
            dougsInvoiceReference: inv.reference ?? m.dougsInvoiceReference,
            dougsStatus: pickDougsStatus(inv),
            dougsTotalHt: pickDougsHt(inv),
            dougsTotalVat: pickDougsVat(inv),
            dougsTotalTtc: pickDougsTtc(inv),
            dougsIssuedAt: pickDougsIssuedAt(inv),
            dougsSyncedAt: new Date().toISOString(),
            paidAt: paidAt ?? m.paidAt,
            status: paidAt ? "paid" : m.status,
          });
        } catch (err) {
          if (err instanceof DougsAuthError) throw err;
          errors.push(`jalon ${m.id}: ${err instanceof Error ? err.message : "?"}`);
          next.push(m);
        }
      } else {
        next.push(m);
      }
    }
    if (changed) {
      await conn
        .update(projects)
        .set({ billingMilestones: next, updatedAt: new Date() })
        .where(eq(projects.id, p.id));
    }
  }

  const cwRows = await conn
    .select({
      id: coworkingInvoices.id,
      dougsInvoiceId: coworkingInvoices.dougsInvoiceId,
      status: coworkingInvoices.status,
    })
    .from(coworkingInvoices);

  for (const cw of cwRows) {
    if (!cw.dougsInvoiceId || cw.status === "payee") continue;
    try {
      const inv = await getDougsSalesInvoice(user.id, cw.dougsInvoiceId);
      const paidAt = pickDougsPaidAt(inv);
      const localStatus = paidAt ? ("payee" as const) : cw.status;
      await conn
        .update(coworkingInvoices)
        .set({
          dougsInvoiceReference: inv.reference ?? null,
          dougsInvoiceStatus: pickDougsStatus(inv),
          dougsInvoiceTotalHt: toNumeric(pickDougsHt(inv)),
          dougsInvoiceTotalVat: toNumeric(pickDougsVat(inv)),
          dougsInvoiceTotalTtc: toNumeric(pickDougsTtc(inv)),
          dougsInvoiceIssuedAt: toDate(pickDougsIssuedAt(inv)),
          dougsInvoicePaidAt: toDate(paidAt),
          dougsInvoiceSyncedAt: new Date(),
          status: localStatus,
          updatedAt: new Date(),
        })
        .where(eq(coworkingInvoices.id, cw.id));
      coworkingUpdated++;
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      errors.push(`coworking ${cw.id}: ${err instanceof Error ? err.message : "?"}`);
    }
  }

  revalidatePath("/rapprochement");
  return { quotesUpdated, milestonesUpdated, coworkingUpdated, errors };
});

/**
 * Re-lier un devis Dougs d'un projet vers un autre projet, sans passer
 * par Dougs. On copie la snapshot du devis (référence, statut, totaux,
 * dates) sur le nouveau projet et on l'efface de l'ancien.
 */
export const relinkProjectDougsQuote = action(
  z.object({
    oldProjectId: z.string().uuid(),
    newProjectId: z.string().uuid(),
  }),
  async ({ input }) => {
    if (input.oldProjectId === input.newProjectId) {
      throw new Error("Source et cible identiques.");
    }
    const conn = await db();
    const [oldRow] = await conn
      .select({
        dougsQuoteId: projects.dougsQuoteId,
        dougsQuoteReference: projects.dougsQuoteReference,
        dougsQuoteStatus: projects.dougsQuoteStatus,
        dougsQuotePushedAt: projects.dougsQuotePushedAt,
        dougsQuoteTotalHt: projects.dougsQuoteTotalHt,
        dougsQuoteTotalTtc: projects.dougsQuoteTotalTtc,
        dougsQuoteTotalVat: projects.dougsQuoteTotalVat,
        dougsQuoteIssuedAt: projects.dougsQuoteIssuedAt,
        dougsQuoteSyncedAt: projects.dougsQuoteSyncedAt,
      })
      .from(projects)
      .where(eq(projects.id, input.oldProjectId))
      .limit(1);
    if (!oldRow?.dougsQuoteId) throw new Error("Aucun devis Dougs lié à l'ancien projet.");

    await conn
      .update(projects)
      .set({
        dougsQuoteId: oldRow.dougsQuoteId,
        dougsQuoteReference: oldRow.dougsQuoteReference,
        dougsQuoteStatus: oldRow.dougsQuoteStatus,
        dougsQuotePushedAt: oldRow.dougsQuotePushedAt,
        dougsQuoteTotalHt: oldRow.dougsQuoteTotalHt,
        dougsQuoteTotalTtc: oldRow.dougsQuoteTotalTtc,
        dougsQuoteTotalVat: oldRow.dougsQuoteTotalVat,
        dougsQuoteIssuedAt: oldRow.dougsQuoteIssuedAt,
        dougsQuoteSyncedAt: oldRow.dougsQuoteSyncedAt,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.newProjectId));

    await conn
      .update(projects)
      .set({
        dougsQuoteId: null,
        dougsQuoteReference: null,
        dougsQuoteStatus: null,
        dougsQuotePushedAt: null,
        dougsQuoteTotalHt: null,
        dougsQuoteTotalTtc: null,
        dougsQuoteTotalVat: null,
        dougsQuoteIssuedAt: null,
        dougsQuoteSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.oldProjectId));

    revalidatePath(`/projets/${input.oldProjectId}`);
    revalidatePath(`/projets/${input.newProjectId}`);
    revalidatePath("/compta");
    return { ok: true };
  },
);

/**
 * Re-lier une facture Dougs d'un jalon vers un autre jalon (même projet
 * ou non). Copie la snapshot Dougs du jalon source vers le jalon cible
 * et efface celle du jalon source.
 */
export const relinkProjectMilestoneDougsInvoice = action(
  z.object({
    oldProjectId: z.string().uuid(),
    oldMilestoneId: z.string().uuid(),
    newProjectId: z.string().uuid(),
    newMilestoneId: z.string().uuid(),
  }),
  async ({ input }) => {
    if (
      input.oldProjectId === input.newProjectId &&
      input.oldMilestoneId === input.newMilestoneId
    ) {
      throw new Error("Source et cible identiques.");
    }
    const conn = await db();

    const [oldP] = await conn
      .select({ billingMilestones: projects.billingMilestones })
      .from(projects)
      .where(eq(projects.id, input.oldProjectId))
      .limit(1);
    if (!oldP) throw new Error("Projet source introuvable.");
    const oldMilestones = (oldP.billingMilestones ?? []) as BillingMilestone[];
    const oldMilestone = oldMilestones.find((m) => m.id === input.oldMilestoneId);
    if (!oldMilestone?.dougsInvoiceId) throw new Error("Aucune facture Dougs sur le jalon source.");

    // Snapshot Dougs à transférer.
    const snap = {
      dougsInvoiceId: oldMilestone.dougsInvoiceId,
      dougsInvoiceReference: oldMilestone.dougsInvoiceReference ?? null,
      dougsStatus: oldMilestone.dougsStatus ?? null,
      dougsTotalHt: oldMilestone.dougsTotalHt ?? null,
      dougsTotalVat: oldMilestone.dougsTotalVat ?? null,
      dougsTotalTtc: oldMilestone.dougsTotalTtc ?? null,
      dougsIssuedAt: oldMilestone.dougsIssuedAt ?? null,
      dougsSyncedAt: oldMilestone.dougsSyncedAt ?? null,
    };

    // Clear sur l'ancien jalon (en garde le reste : label, montant, statut local).
    const updatedOld = oldMilestones.map((m) =>
      m.id === input.oldMilestoneId
        ? {
            ...m,
            dougsInvoiceId: null,
            dougsInvoiceReference: null,
            dougsStatus: null,
            dougsTotalHt: null,
            dougsTotalVat: null,
            dougsTotalTtc: null,
            dougsIssuedAt: null,
            dougsSyncedAt: null,
          }
        : m,
    );

    // Charge le projet cible (peut être le même).
    let newMilestones: BillingMilestone[];
    if (input.newProjectId === input.oldProjectId) {
      newMilestones = updatedOld;
    } else {
      const [newP] = await conn
        .select({ billingMilestones: projects.billingMilestones })
        .from(projects)
        .where(eq(projects.id, input.newProjectId))
        .limit(1);
      if (!newP) throw new Error("Projet cible introuvable.");
      newMilestones = (newP.billingMilestones ?? []) as BillingMilestone[];
      // Sauve l'ancien projet d'abord (cas inter-projet).
      await conn
        .update(projects)
        .set({ billingMilestones: updatedOld, updatedAt: new Date() })
        .where(eq(projects.id, input.oldProjectId));
    }

    const newIdx = newMilestones.findIndex((m) => m.id === input.newMilestoneId);
    if (newIdx === -1) throw new Error("Jalon cible introuvable.");
    const newMilestone = newMilestones[newIdx];
    if (!newMilestone) throw new Error("Jalon cible introuvable.");
    if (newMilestone.dougsInvoiceId) {
      throw new Error("Le jalon cible a déjà une facture Dougs liée.");
    }

    const nextNew = [...newMilestones];
    nextNew[newIdx] = {
      ...newMilestone,
      ...snap,
      status: newMilestone.status === "todo" ? "invoiced" : newMilestone.status,
    };

    await conn
      .update(projects)
      .set({ billingMilestones: nextNew, updatedAt: new Date() })
      .where(eq(projects.id, input.newProjectId));

    revalidatePath(`/projets/${input.oldProjectId}`);
    revalidatePath(`/projets/${input.newProjectId}`);
    revalidatePath("/compta");
    return { ok: true };
  },
);

/**
 * Re-lier une facture Dougs d'une facture coworking vers une autre.
 */
export const relinkCoworkingInvoiceDougs = action(
  z.object({
    oldCoworkingInvoiceId: z.string().uuid(),
    newCoworkingInvoiceId: z.string().uuid(),
  }),
  async ({ input }) => {
    if (input.oldCoworkingInvoiceId === input.newCoworkingInvoiceId) {
      throw new Error("Source et cible identiques.");
    }
    const conn = await db();
    const [oldRow] = await conn
      .select()
      .from(coworkingInvoices)
      .where(eq(coworkingInvoices.id, input.oldCoworkingInvoiceId))
      .limit(1);
    if (!oldRow?.dougsInvoiceId) {
      throw new Error("Aucune facture Dougs sur la coworking source.");
    }

    const [target] = await conn
      .select({ dougsInvoiceId: coworkingInvoices.dougsInvoiceId })
      .from(coworkingInvoices)
      .where(eq(coworkingInvoices.id, input.newCoworkingInvoiceId))
      .limit(1);
    if (!target) throw new Error("Facture coworking cible introuvable.");
    if (target.dougsInvoiceId) {
      throw new Error("La facture coworking cible a déjà une facture Dougs liée.");
    }

    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceId: oldRow.dougsInvoiceId,
        dougsInvoiceReference: oldRow.dougsInvoiceReference,
        dougsInvoiceStatus: oldRow.dougsInvoiceStatus,
        dougsInvoiceTotalHt: oldRow.dougsInvoiceTotalHt,
        dougsInvoiceTotalVat: oldRow.dougsInvoiceTotalVat,
        dougsInvoiceTotalTtc: oldRow.dougsInvoiceTotalTtc,
        dougsInvoiceIssuedAt: oldRow.dougsInvoiceIssuedAt,
        dougsInvoicePaidAt: oldRow.dougsInvoicePaidAt,
        dougsInvoiceSyncedAt: oldRow.dougsInvoiceSyncedAt,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.newCoworkingInvoiceId));

    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceId: null,
        dougsInvoiceReference: null,
        dougsInvoiceStatus: null,
        dougsInvoiceTotalHt: null,
        dougsInvoiceTotalVat: null,
        dougsInvoiceTotalTtc: null,
        dougsInvoiceIssuedAt: null,
        dougsInvoicePaidAt: null,
        dougsInvoiceSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.oldCoworkingInvoiceId));

    revalidatePath(`/coworking/factures/${input.oldCoworkingInvoiceId}`);
    revalidatePath(`/coworking/factures/${input.newCoworkingInvoiceId}`);
    revalidatePath("/coworking");
    revalidatePath("/compta");
    return { ok: true };
  },
);

/**
 * Coupe le lien entre un jalon projet et sa facture Dougs. Garde le
 * jalon en place mais efface tous les snapshots Dougs. Le statut du
 * jalon reste tel quel (invoiced/paid pas remis à todo) : si l'user a
 * marqué le jalon payé à la main, on respecte cette donnée locale.
 */
export const unlinkProjectMilestoneDougsInvoice = action(
  z.object({
    projectId: z.string().uuid(),
    milestoneId: z.string().uuid(),
  }),
  async ({ input }) => {
    const conn = await db();
    const [row] = await conn
      .select({ billingMilestones: projects.billingMilestones })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!row) throw new Error("Projet introuvable.");

    const milestones = (row.billingMilestones ?? []) as BillingMilestone[];
    const idx = milestones.findIndex((m) => m.id === input.milestoneId);
    if (idx === -1) throw new Error("Jalon introuvable.");
    const milestone = milestones[idx];
    if (!milestone) throw new Error("Jalon introuvable.");

    const next = [...milestones];
    next[idx] = {
      ...milestone,
      dougsInvoiceId: null,
      dougsInvoiceReference: null,
      dougsStatus: null,
      dougsTotalHt: null,
      dougsTotalVat: null,
      dougsTotalTtc: null,
      dougsIssuedAt: null,
      dougsSyncedAt: null,
    };

    await conn
      .update(projects)
      .set({ billingMilestones: next, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    revalidatePath("/compta");
    return { ok: true };
  },
);

/**
 * Coupe le lien entre une facture coworking et sa facture Dougs. Efface
 * les snapshots Dougs mais conserve la facture coworking et son statut.
 */
export const unlinkCoworkingInvoiceDougs = action(
  z.object({ coworkingInvoiceId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceId: null,
        dougsInvoiceReference: null,
        dougsInvoiceStatus: null,
        dougsInvoiceTotalHt: null,
        dougsInvoiceTotalVat: null,
        dougsInvoiceTotalTtc: null,
        dougsInvoiceIssuedAt: null,
        dougsInvoicePaidAt: null,
        dougsInvoiceSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId));

    revalidatePath(`/coworking/factures/${input.coworkingInvoiceId}`);
    revalidatePath("/coworking");
    revalidatePath("/compta");
    return { ok: true };
  },
);
