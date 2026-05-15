"use server";

import { coworkingInvoices } from "@/db/schema/coworking";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  getDougsQuote,
  getDougsSalesInvoice,
} from "@/lib/dougs/client";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function toNumeric(n: number | undefined): string | null {
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
        dougsQuoteStatus: quote.status ?? null,
        dougsQuoteTotalHt: toNumeric(quote.totalNetAmount),
        dougsQuoteTotalVat: toNumeric(quote.totalVatAmount),
        dougsQuoteTotalTtc: toNumeric(quote.totalAmountWithVat),
        dougsQuoteIssuedAt: toDate(quote.issuedAt),
        dougsQuoteSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: quote.reference ?? null,
      status: quote.status ?? null,
      totalTtc: quote.totalAmountWithVat ?? null,
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

    const next = [...milestones];
    next[idx] = {
      ...milestone,
      dougsInvoiceReference: invoice.reference ?? milestone.dougsInvoiceReference,
      dougsStatus: invoice.status ?? null,
      dougsTotalHt: typeof invoice.totalNetAmount === "number" ? invoice.totalNetAmount : null,
      dougsTotalVat: typeof invoice.totalVatAmount === "number" ? invoice.totalVatAmount : null,
      dougsTotalTtc:
        typeof invoice.totalAmountWithVat === "number" ? invoice.totalAmountWithVat : null,
      dougsIssuedAt: invoice.issuedAt ?? null,
      dougsSyncedAt: new Date().toISOString(),
      // Si Dougs a marqué la facture comme payée, on met aussi à jour
      // notre statut local (paid). Sinon on touche pas — l'humain peut
      // avoir marqué payé à la main avant que Dougs le sache.
      paidAt: invoice.paidAt ?? milestone.paidAt,
      status: invoice.paidAt && milestone.status !== "paid" ? "paid" : milestone.status,
    };

    await conn
      .update(projects)
      .set({ billingMilestones: next, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: invoice.reference ?? null,
      status: invoice.status ?? null,
      paidAt: invoice.paidAt ?? null,
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
        dougsQuoteStatus: quote.status ?? null,
        dougsQuoteTotalHt: toNumeric(quote.totalNetAmount),
        dougsQuoteTotalVat: toNumeric(quote.totalVatAmount),
        dougsQuoteTotalTtc: toNumeric(quote.totalAmountWithVat),
        dougsQuoteIssuedAt: toDate(quote.issuedAt),
        dougsQuotePushedAt: new Date(),
        dougsQuoteSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: quote.reference ?? null,
      status: quote.status ?? null,
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
      dougsStatus: invoice.status ?? null,
      dougsTotalHt: typeof invoice.totalNetAmount === "number" ? invoice.totalNetAmount : null,
      dougsTotalVat: typeof invoice.totalVatAmount === "number" ? invoice.totalVatAmount : null,
      dougsTotalTtc:
        typeof invoice.totalAmountWithVat === "number" ? invoice.totalAmountWithVat : null,
      dougsIssuedAt: invoice.issuedAt ?? null,
      dougsSyncedAt: new Date().toISOString(),
      invoicedAt: milestone.invoicedAt ?? new Date().toISOString(),
      paidAt: invoice.paidAt ?? milestone.paidAt,
      status: invoice.paidAt ? "paid" : milestone.status === "todo" ? "invoiced" : milestone.status,
    };

    await conn
      .update(projects)
      .set({ billingMilestones: next, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    revalidatePath(`/projets/${input.projectId}`);
    return {
      reference: invoice.reference ?? null,
      status: invoice.status ?? null,
    };
  },
);

/**
 * Lie une facture Dougs existante à une facture coworking.
 */
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

    const localStatus =
      invoice.paidAt && row.status !== "payee"
        ? ("payee" as const)
        : row.status === "a_facturer"
          ? ("envoyee" as const)
          : row.status;

    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceId: dougsId,
        dougsInvoiceReference: invoice.reference ?? null,
        dougsInvoiceStatus: invoice.status ?? null,
        dougsInvoiceTotalHt: toNumeric(invoice.totalNetAmount),
        dougsInvoiceTotalVat: toNumeric(invoice.totalVatAmount),
        dougsInvoiceTotalTtc: toNumeric(invoice.totalAmountWithVat),
        dougsInvoiceIssuedAt: toDate(invoice.issuedAt),
        dougsInvoicePaidAt: toDate(invoice.paidAt),
        dougsInvoiceSyncedAt: new Date(),
        status: localStatus,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId));

    revalidatePath(`/coworking/factures/${input.coworkingInvoiceId}`);
    revalidatePath("/coworking");
    return {
      reference: invoice.reference ?? null,
      status: invoice.status ?? null,
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
    const localStatus = invoice.paidAt && row.status !== "payee" ? ("payee" as const) : row.status;

    await conn
      .update(coworkingInvoices)
      .set({
        dougsInvoiceReference: invoice.reference ?? null,
        dougsInvoiceStatus: invoice.status ?? null,
        dougsInvoiceTotalHt: toNumeric(invoice.totalNetAmount),
        dougsInvoiceTotalVat: toNumeric(invoice.totalVatAmount),
        dougsInvoiceTotalTtc: toNumeric(invoice.totalAmountWithVat),
        dougsInvoiceIssuedAt: toDate(invoice.issuedAt),
        dougsInvoicePaidAt: toDate(invoice.paidAt),
        dougsInvoiceSyncedAt: new Date(),
        status: localStatus,
        updatedAt: new Date(),
      })
      .where(eq(coworkingInvoices.id, input.coworkingInvoiceId));

    revalidatePath(`/coworking/factures/${input.coworkingInvoiceId}`);
    revalidatePath("/coworking");
    return {
      reference: invoice.reference ?? null,
      status: invoice.status ?? null,
      paidAt: invoice.paidAt ?? null,
    };
  },
);
