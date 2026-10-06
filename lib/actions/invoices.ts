"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { coworkingContracts } from "@/db/schema/coworking";
import { type InvoiceBrand, invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import {
  loadDealBillingTerms,
  resolveProjectOwner,
  revalidatePathsForInvoice,
} from "@/lib/actions/invoice-helpers";
import { resolveBillingTerms } from "@/lib/billing/billing-terms";
import { brandForInvoice, brandTemplateFor } from "@/lib/billing/brand-templates";
import {
  resolveStatusTransition,
  resolveUpsertDueDate,
  toNumeric,
} from "@/lib/billing/invoice-lifecycle";
import {
  coworkingInvoiceAmountHt,
  DEFAULT_ACOMPTE_PERCENT,
  splitMilestoneAmounts,
} from "@/lib/billing/milestones-math";
import { db } from "@/lib/db/server";
import { monthsBetween } from "@/lib/schemas/coworking";

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
  /** Échéance au format YYYY-MM-DD. Si non fournie et que status passe à
   *  'sent' alors qu'aucune due_date n'existe encore, on calcule
   *  invoiced_at (ou now) + 30j. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/**
 * Crée ou met à jour une facture (tout `kind`). UPSERT par `id` si fourni.
 * Garde les champs Dougs intacts (utilise linkInvoiceDougs pour les modifier).
 */
export const upsertInvoice = action(upsertInvoiceSchema, async ({ input, user }) => {
  const conn = await db();

  // Pour résoudre la due_date par défaut au passage à 'sent', on a besoin
  // de l'état actuel (invoicedAt + dueDate déjà set ?). Lecture une fois,
  // pas de race significative : un upsert n'est pas concurrent sur la
  // même ligne en pratique.
  let existing: {
    brand: InvoiceBrand;
    invoicedAt: Date | null;
    dueDate: string | null;
    assignedTo: string | null;
  } | null = null;
  if (input.id) {
    const [row] = await conn
      .select({
        brand: invoices.brand,
        invoicedAt: invoices.invoicedAt,
        dueDate: invoices.dueDate,
        assignedTo: invoices.assignedTo,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    existing = row ?? null;
  }

  // Assignee : on garde existant si déjà posé. Sinon, on tente de
  // récupérer le owner du projet (lead). Pour le coworking sans projet,
  // reste null jusqu'à assignation manuelle.
  const nextAssignedTo =
    existing?.assignedTo ?? (await resolveProjectOwner(conn, input.projectId ?? null));

  // Calcul due_date : si l'appelant en fournit une, elle l'emporte
  // (y compris null explicite). Sinon, on garde l'existante. Sinon, on
  // génère une valeur uniquement quand status='sent' (point d'émission).
  // La marque n'est jamais écrasée par un upsert : à la création elle est
  // déduite du kind, ensuite elle reste celle qu'on a (éventuellement
  // corrigée à la main sur la fiche).
  const brand =
    existing?.brand ??
    brandForInvoice({
      kind: input.kind,
      coworkingContractId: input.coworkingContractId ?? null,
    });

  // Conditions du deal : elles surchargent les défauts de la marque, donc
  // elles déterminent aussi l'échéance. Sans cette lecture, une facture d'un
  // projet à 60 jours repartirait sur les 30 jours de la marque.
  const dealTerms = await loadDealBillingTerms(conn, {
    projectId: input.projectId ?? null,
    coworkingContractId: input.coworkingContractId ?? null,
  });

  const nextDueDate = resolveUpsertDueDate({
    inputDueDate: input.dueDate,
    status: input.status,
    existing,
    now: new Date(),
    dueDays: resolveBillingTerms(brand, dealTerms).dueDays,
  });

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
    dueDate: nextDueDate,
    assignedTo: nextAssignedTo,
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
      .values({ ...baseValues, brand, createdBy: user.id })
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
        brand: invoices.brand,
        invoicedAt: invoices.invoicedAt,
        paidAt: invoices.paidAt,
        dueDate: invoices.dueDate,
        assignedTo: invoices.assignedTo,
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Facture introuvable.");

    // Dates dérivées du nouveau statut (cf. resolveStatusTransition) :
    // au passage à 'sent' sans due_date, on initialise à invoiced_at + le
    // délai de la marque (cohérent avec upsertInvoice).
    const dealTerms = await loadDealBillingTerms(conn, {
      projectId: existing.projectId,
      coworkingContractId: existing.coworkingContractId,
    });
    const transition = resolveStatusTransition({
      status: input.status,
      existing,
      now,
      dueDays: resolveBillingTerms(existing.brand, dealTerms).dueDays,
    });
    // Assignee : pose le lead projet à 'sent' s'il n'y a personne.
    // Ça couvre le cas d'une facture créée avant l'arrivée du champ
    // (backfill OK pour celles liées à un projet) ou d'un upsert qui
    // aurait passé null explicite.
    const nextAssignedTo = transition.needsAssigneeFromProject
      ? await resolveProjectOwner(conn, existing.projectId)
      : existing.assignedTo;

    await conn
      .update(invoices)
      .set({
        status: input.status,
        invoicedAt: transition.invoicedAt,
        paidAt: transition.paidAt,
        dueDate: transition.dueDate,
        assignedTo: nextAssignedTo,
        updatedAt: now,
      })
      .where(eq(invoices.id, input.id));

    revalidatePathsForInvoice(existing.projectId, existing.coworkingContractId, input.id);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

// =====================================================================
// Relances : pilotage de la due_date et trace des relances émises.
// =====================================================================

/**
 * Met à jour l'échéance d'une facture. Accepte null pour effacer.
 * Valeur attendue au format YYYY-MM-DD.
 */
export const setInvoiceDueDate = action(
  z.object({
    id: z.string().uuid(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  }),
  async ({ input }) => {
    const conn = await db();
    const [existing] = await conn
      .select({
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Facture introuvable.");

    await conn
      .update(invoices)
      .set({ dueDate: input.dueDate, updatedAt: new Date() })
      .where(eq(invoices.id, input.id));

    revalidatePathsForInvoice(existing.projectId, existing.coworkingContractId, input.id);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

/**
 * Assigne une facture à un utilisateur (ou null pour désassigner).
 * Utilisé depuis la liste des relances et la fiche projet.
 */
export const setInvoiceAssignee = action(
  z.object({
    id: z.string().uuid(),
    assignedTo: z.string().uuid().nullable(),
  }),
  async ({ input }) => {
    const conn = await db();
    const [existing] = await conn
      .select({
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Facture introuvable.");

    await conn
      .update(invoices)
      .set({ assignedTo: input.assignedTo, updatedAt: new Date() })
      .where(eq(invoices.id, input.id));

    revalidatePathsForInvoice(existing.projectId, existing.coworkingContractId, input.id);
    revalidatePath("/compta");
    revalidatePath("/");
    return { ok: true as const };
  },
);

/**
 * Marque une facture comme relancée : pose last_reminded_at = now() et
 * incrémente reminder_count. Pas d'opération inverse — si on s'est
 * trompé, on édite directement la facture.
 */
export const markInvoiceReminded = action(
  z.object({ id: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    const [existing] = await conn
      .select({
        projectId: invoices.projectId,
        coworkingContractId: invoices.coworkingContractId,
      })
      .from(invoices)
      .where(eq(invoices.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Facture introuvable.");

    await conn
      .update(invoices)
      .set({
        lastRemindedAt: new Date(),
        reminderCount: sql`${invoices.reminderCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, input.id));

    revalidatePathsForInvoice(existing.projectId, existing.coworkingContractId, input.id);
    revalidatePath("/compta");
    revalidatePath("/");
    return { ok: true as const };
  },
);

// =====================================================================
// Helpers spécifiques jalons projet
// =====================================================================

const seedSchema = z.object({
  projectId: z.string().uuid(),
  totalHt: z.number().nonnegative(),
  acomptePercent: z.number().int().min(0).max(100).default(DEFAULT_ACOMPTE_PERCENT),
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

  const split = splitMilestoneAmounts(input.totalHt, input.acomptePercent);
  const ownerId = await resolveProjectOwner(conn, input.projectId);

  await conn.insert(invoices).values([
    {
      kind: "milestone",
      brand: "automato",
      projectId: input.projectId,
      label: split.acompte.label,
      amountHt: toNumeric(split.acompte.amountHt) ?? "0",
      vatRate: brandTemplateFor("automato").defaultVatRate.toString(),
      status: "draft",
      milestoneType: "acompte",
      milestonePercent: split.acompte.percent,
      assignedTo: ownerId,
      createdBy: user.id,
    },
    {
      kind: "milestone",
      brand: "automato",
      projectId: input.projectId,
      label: split.solde.label,
      amountHt: toNumeric(split.solde.amountHt) ?? "0",
      vatRate: brandTemplateFor("automato").defaultVatRate.toString(),
      status: "draft",
      milestoneType: "solde",
      milestonePercent: split.solde.percent,
      assignedTo: ownerId,
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
  const amountHt = coworkingInvoiceAmountHt(input.desks, input.unitPriceHt, months);
  const [row] = await conn
    .insert(invoices)
    .values({
      kind: "coworking",
      brand: "coworking",
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
      update.amountHt = toNumeric(coworkingInvoiceAmountHt(desks, unit, months));
    }
  }

  await conn.update(invoices).set(update).where(eq(invoices.id, input.id));
  revalidatePath("/coworking");
  revalidatePath(`/coworking/factures/${input.id}`);
  revalidatePath("/compta");
  return { id: input.id };
});

// =====================================================================
// Conditions de facturation négociées par deal
// =====================================================================

/**
 * Enregistre les conditions d'un projet ou d'un contrat coworking.
 *
 * Volontairement **épars** : une valeur vide n'est pas stockée comme chaîne
 * vide, elle est retirée de l'objet. C'est ce qui fait qu'on « revient au
 * défaut de la marque » en vidant un champ, plutôt que d'imposer un texte
 * vide sur la facture.
 */
export const setBillingTerms = action(
  z.object({
    projectId: z.string().uuid().optional(),
    coworkingContractId: z.string().uuid().optional(),
    paymentTerms: z.string().trim().max(1000).optional(),
    dueDateOption: z.enum(["DAYS_15", "DAYS_30", "DAYS_60"]).optional(),
    footerOthers: z.array(z.string().trim().max(1000)).max(5).optional(),
    thankYouNote: z.string().trim().max(2000).optional(),
    /** Efface explicitement la note, au lieu de garder celle de la marque. */
    clearThankYouNote: z.boolean().optional(),
  }),
  async ({ input }) => {
    if (!input.projectId && !input.coworkingContractId) {
      throw new Error("Préciser un projet ou un contrat coworking.");
    }
    const conn = await db();

    const terms: Record<string, unknown> = {};
    if (input.paymentTerms) terms.paymentTerms = input.paymentTerms;
    if (input.dueDateOption) terms.dueDateOption = input.dueDateOption;
    const footer = (input.footerOthers ?? []).filter((l) => l.length > 0);
    if (footer.length > 0) terms.footerOthers = footer;
    if (input.clearThankYouNote) terms.thankYouNote = null;
    else if (input.thankYouNote) terms.thankYouNote = input.thankYouNote;

    // Aucune condition négociée : on efface la colonne plutôt que d'y laisser
    // un objet vide, pour que « pas de surcharge » se lise d'un coup d'œil.
    const value = Object.keys(terms).length > 0 ? terms : null;

    if (input.projectId) {
      await conn
        .update(projects)
        .set({ billingTerms: value, updatedAt: new Date() })
        .where(eq(projects.id, input.projectId));
      revalidatePath(`/projets/${input.projectId}`);
    } else if (input.coworkingContractId) {
      await conn
        .update(coworkingContracts)
        .set({ billingTerms: value, updatedAt: new Date() })
        .where(eq(coworkingContracts.id, input.coworkingContractId));
      revalidatePath(`/coworking/contrats/${input.coworkingContractId}`);
    }
    revalidatePath("/compta");
    return { ok: true as const, hasTerms: value !== null };
  },
);
