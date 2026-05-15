"use server";

import { randomUUID } from "node:crypto";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  createDougsSalesInvoiceDraft,
  getDougsDraftUrl,
  searchDougsClients,
  updateDougsSalesInvoice,
} from "@/lib/dougs/client";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const typeEnum = z.enum(["acompte", "intermediaire", "solde"]);
const statusEnum = z.enum(["todo", "invoiced", "paid"]);

const upsertSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable(),
  type: typeEnum,
  label: z.string().trim().min(1, "Label requis.").max(120),
  percent: z.number().min(0).max(100).nullable(),
  amountHt: z.number().nonnegative(),
  vatRate: z.number().min(0).max(1).default(0.2),
});

const idSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid(),
});

const statusSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid(),
  status: statusEnum,
});

async function loadMilestones(projectId: string): Promise<{
  milestones: BillingMilestone[];
  valueAmount: number;
}> {
  const conn = await db();
  const [row] = await conn
    .select({
      milestones: projects.billingMilestones,
      valueAmount: projects.valueAmount,
      budget: projects.budgetAmount,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) throw new Error("Projet introuvable.");
  return {
    milestones: (row.milestones ?? []) as BillingMilestone[],
    valueAmount: Number(row.valueAmount ?? row.budget ?? 0),
  };
}

async function saveMilestones(projectId: string, next: BillingMilestone[]) {
  const conn = await db();
  await conn
    .update(projects)
    .set({ billingMilestones: next, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  revalidatePath(`/projets/${projectId}`);
}

export const upsertProjectBillingMilestone = action(upsertSchema, async ({ input }) => {
  const { milestones } = await loadMilestones(input.projectId);
  const next = [...milestones];
  if (input.milestoneId) {
    const idx = next.findIndex((m) => m.id === input.milestoneId);
    if (idx === -1) throw new Error("Jalon introuvable.");
    const prev = next[idx];
    if (!prev) throw new Error("Jalon introuvable.");
    next[idx] = {
      ...prev,
      type: input.type,
      label: input.label,
      percent: input.percent,
      amountHt: Math.round(input.amountHt * 100) / 100,
      vatRate: input.vatRate,
    };
  } else {
    next.push({
      id: randomUUID(),
      type: input.type,
      label: input.label,
      percent: input.percent,
      amountHt: Math.round(input.amountHt * 100) / 100,
      vatRate: input.vatRate,
      status: "todo",
      dougsInvoiceId: null,
      dougsInvoiceReference: null,
      invoicedAt: null,
      paidAt: null,
    });
  }
  await saveMilestones(input.projectId, next);
  return { ok: true as const };
});

export const removeProjectBillingMilestone = action(idSchema, async ({ input }) => {
  const { milestones } = await loadMilestones(input.projectId);
  const next = milestones.filter((m) => m.id !== input.milestoneId);
  await saveMilestones(input.projectId, next);
  return { ok: true as const };
});

/**
 * Force le statut d'un jalon (utile pour "Marquer payé" manuel, ou
 * revenir en arrière). Met à jour les timestamps en cohérence.
 */
export const setProjectBillingMilestoneStatus = action(statusSchema, async ({ input }) => {
  const { milestones } = await loadMilestones(input.projectId);
  const idx = milestones.findIndex((m) => m.id === input.milestoneId);
  if (idx === -1) throw new Error("Jalon introuvable.");
  const prev = milestones[idx];
  if (!prev) throw new Error("Jalon introuvable.");
  const now = new Date().toISOString();
  const next = [...milestones];
  next[idx] = {
    ...prev,
    status: input.status,
    invoicedAt: input.status === "todo" ? null : (prev.invoicedAt ?? now),
    paidAt:
      input.status === "paid" ? (prev.paidAt ?? now) : input.status === "todo" ? null : prev.paidAt,
  };
  await saveMilestones(input.projectId, next);
  return { ok: true as const };
});

/**
 * Pousse un jalon vers Dougs comme brouillon de facture. Une seule
 * ligne reprenant le label du jalon (avec mention du % si défini) et
 * le montant HT. Stocke le `dougsInvoiceId` sur le jalon, statut → invoiced.
 *
 * Ne **finalise pas** — PY valide depuis Dougs.
 */
export const pushProjectMilestoneToDougs = action(idSchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .select({
      project: projects,
      entityName: entitiesTable.name,
      entitySiren: entitiesTable.siren,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      contactEmail: contactsTable.email,
    })
    .from(projects)
    .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
    .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!row) throw new Error("Projet introuvable.");
  const { project } = row;
  if (project.kind !== "client") {
    throw new Error("Facturation Dougs disponible uniquement pour les projets 'client'.");
  }
  if (!project.entityId || !row.entityName) {
    throw new Error("Entité de facturation manquante sur le projet.");
  }

  const milestones = (project.billingMilestones ?? []) as BillingMilestone[];
  const milestone = milestones.find((m) => m.id === input.milestoneId);
  if (!milestone) throw new Error("Jalon introuvable.");
  if (milestone.amountHt <= 0) throw new Error("Montant du jalon = 0.");

  // ClientData — pattern identique au push coworking/devis.
  let clientData: Record<string, unknown>;
  try {
    const matches = await searchDougsClients(user.id, row.entityName, true);
    const best = matches[0];
    if (best) {
      clientData = {
        isBToB: best.isBtoB,
        legalName: best.legalName ?? best.name,
        siren: best.siren,
        siret: null,
        vatNumber: best.vatNumber,
        firstName: best.firstName,
        lastName: best.lastName,
        address: best.address
          ? {
              street: best.address.street ?? "",
              zipCode: best.address.zipcode ?? "",
              city: best.address.city ?? "",
              country: "France",
            }
          : { street: "", zipCode: "", city: "", country: "France" },
        deliveryAddress: { street: "", zipCode: "", city: "", country: "" },
        others: [],
        email: best.email ?? row.contactEmail ?? null,
        phone: best.phone ?? null,
        clientId: best.clientId,
      };
    } else {
      const localAddr = row.entityAddress as {
        street?: string;
        postalCode?: string;
        city?: string;
        country?: string;
      } | null;
      clientData = {
        isBToB: true,
        legalName: row.entityName,
        siren: row.entitySiren ?? null,
        siret: null,
        vatNumber: row.entityVatNumber ?? null,
        firstName: null,
        lastName: null,
        address: {
          street: localAddr?.street ?? "",
          zipCode: localAddr?.postalCode ?? "",
          city: localAddr?.city ?? "",
          country: localAddr?.country ?? "France",
        },
        deliveryAddress: { street: "", zipCode: "", city: "", country: "" },
        others: [],
        email: row.contactEmail ?? null,
        phone: null,
        clientId: null,
      };
    }
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    if (err instanceof DougsApiError) {
      throw new Error(`Recherche client Dougs : ${err.message}`);
    }
    throw err;
  }

  const description =
    milestone.percent != null
      ? `${milestone.percent.toLocaleString("fr-FR")} % du projet "${project.name}".`
      : `Facture liée au projet "${project.name}".`;

  const lines = [
    {
      title: milestone.label,
      description,
      unit: "forfait",
      quantity: 1,
      unitAmount: milestone.amountHt,
      vatRate: milestone.vatRate,
      discount: 0,
      discountUnit: "%",
      reference: null,
      amount: milestone.amountHt,
      discountInEuros: 0,
      isPriceWithVat: false,
    },
  ];

  let draft: Awaited<ReturnType<typeof createDougsSalesInvoiceDraft>>;
  try {
    draft = await createDougsSalesInvoiceDraft(user.id);
    await updateDougsSalesInvoice(user.id, draft.id, {
      ...draft,
      clientData,
      lines,
    });
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    if (err instanceof DougsApiError) {
      throw new Error(`Push Dougs : ${err.message}`);
    }
    throw err;
  }

  // Update du jalon dans le tableau JSON.
  const idx = milestones.findIndex((m) => m.id === input.milestoneId);
  const next = [...milestones];
  next[idx] = {
    ...milestone,
    status: "invoiced",
    dougsInvoiceId: draft.id,
    dougsInvoiceReference: draft.reference,
    invoicedAt: new Date().toISOString(),
  };
  await saveMilestones(input.projectId, next);

  const url = await getDougsDraftUrl(user.id, draft.id);
  return { dougsId: draft.id, reference: draft.reference, url };
});

/**
 * Initialise les jalons par défaut (30% acompte / 70% solde) à partir
 * du montant projet. Idempotent : refuse si déjà non-vide.
 */
export const seedDefaultBillingMilestones = action(
  z.object({ projectId: z.string().uuid() }),
  async ({ input }) => {
    const { milestones, valueAmount } = await loadMilestones(input.projectId);
    if (milestones.length > 0) {
      throw new Error("Des jalons existent déjà.");
    }
    if (valueAmount <= 0) {
      throw new Error("Saisis d'abord un montant projet (valueAmount ou budgetAmount).");
    }
    const acompte = Math.round(valueAmount * 0.4 * 100) / 100;
    const solde = Math.round((valueAmount - acompte) * 100) / 100;
    const next: BillingMilestone[] = [
      {
        id: randomUUID(),
        type: "acompte",
        label: "Acompte 40 %",
        percent: 40,
        amountHt: acompte,
        vatRate: 0.2,
        status: "todo",
        dougsInvoiceId: null,
        dougsInvoiceReference: null,
        invoicedAt: null,
        paidAt: null,
      },
      {
        id: randomUUID(),
        type: "solde",
        label: "Solde 60 %",
        percent: 60,
        amountHt: solde,
        vatRate: 0.2,
        status: "todo",
        dougsInvoiceId: null,
        dougsInvoiceReference: null,
        invoicedAt: null,
        paidAt: null,
      },
    ];
    await saveMilestones(input.projectId, next);
    return { ok: true as const };
  },
);
