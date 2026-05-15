"use server";

import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  createDougsQuoteDraft,
  getDougsQuoteDraft,
  getDougsQuoteUrl,
  searchDougsClients,
  updateDougsQuote,
} from "@/lib/dougs/client";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const lineSchema = z.object({
  title: z.string().trim().min(1, "Titre requis."),
  description: z.string().trim().default(""),
  unit: z.string().trim().min(1).default("forfait"),
  quantity: z.number().positive("Quantité > 0."),
  unitAmount: z.number().nonnegative(),
  vatRate: z.number().min(0).max(1).default(0.2),
  discount: z.number().nonnegative().default(0),
  discountUnit: z.enum(["%", "€"]).default("%"),
});

const pushSchema = z.object({
  projectId: z.string().uuid(),
  subject: z.string().trim().max(500).default(""),
  thankYouNote: z.string().trim().max(2000).default(""),
  lines: z.array(lineSchema).min(1, "Au moins une ligne."),
});

type QuoteLineInput = z.infer<typeof lineSchema>;

function computeLineAmount(line: QuoteLineInput): number {
  const gross = line.quantity * line.unitAmount;
  if (line.discountUnit === "%") {
    return Math.round(gross * (1 - line.discount / 100) * 100) / 100;
  }
  return Math.round(Math.max(0, gross - line.discount) * 100) / 100;
}

function computeLineDiscountInEuros(line: QuoteLineInput): number {
  const gross = line.quantity * line.unitAmount;
  if (line.discountUnit === "%") {
    return Math.round(((gross * line.discount) / 100) * 100) / 100;
  }
  return Math.min(gross, line.discount);
}

/**
 * Pousse (ou re-pousse) le devis Dougs lié à un projet. Crée le brouillon
 * la première fois, fait un PUT update les fois suivantes tant que le
 * devis Dougs reste en DRAFT.
 *
 * Ne **finalise pas** — PY valide et envoie depuis l'UI Dougs.
 */
export const pushProjectQuoteToDougs = action(pushSchema, async ({ input, user }) => {
  const conn = await db();

  const [row] = await conn
    .select({
      project: projects,
      entityName: entitiesTable.name,
      entitySiren: entitiesTable.siren,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
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
    throw new Error("Devis disponible uniquement pour les projets de type 'client'.");
  }
  if (!project.entityId) {
    throw new Error("Entité de facturation manquante sur le projet.");
  }
  if (!row.entityName) throw new Error("Nom d'entité manquant.");

  // Projets client = B2B par construction (entityId requis).
  const isBtoB = true;

  let clientData: Record<string, unknown>;
  try {
    const matches = await searchDougsClients(user.id, row.entityName, isBtoB);
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

  const lines = input.lines.map((l) => ({
    title: l.title,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    vatRate: l.vatRate,
    discount: l.discount,
    discountUnit: l.discountUnit,
    reference: null,
    amount: computeLineAmount(l),
    discountInEuros: computeLineDiscountInEuros(l),
    isPriceWithVat: false,
  }));

  let quoteId: string;
  let reference: string;
  let status: string;

  try {
    // Re-push : on update si on a déjà un draft Dougs et qu'il est encore
    // en DRAFT (sinon Dougs refuse le PUT).
    const existing = project.dougsQuoteId;
    if (existing && (project.dougsQuoteStatus ?? "DRAFT") === "DRAFT") {
      const current = await getDougsQuoteDraft(user.id, existing);
      const updated = await updateDougsQuote(user.id, existing, {
        ...current,
        subject: input.subject,
        thankYouNote: input.thankYouNote,
        clientData,
        lines,
      });
      quoteId = updated.id;
      reference = updated.reference;
      status = (updated.status as string) ?? "DRAFT";
    } else {
      const draft = await createDougsQuoteDraft(user.id);
      const updated = await updateDougsQuote(user.id, draft.id, {
        ...draft,
        subject: input.subject,
        thankYouNote: input.thankYouNote,
        clientData,
        lines,
      });
      quoteId = updated.id;
      reference = updated.reference;
      status = (updated.status as string) ?? "DRAFT";
    }
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    if (err instanceof DougsApiError) {
      throw new Error(`Push Dougs : ${err.message}`);
    }
    throw err;
  }

  await conn
    .update(projects)
    .set({
      dougsQuoteId: quoteId,
      dougsQuoteReference: reference,
      dougsQuoteStatus: status,
      dougsQuotePushedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, input.projectId));

  const url = await getDougsQuoteUrl(user.id, quoteId);
  revalidatePath(`/projets/${input.projectId}`);
  return { dougsId: quoteId, reference, status, url };
});

/**
 * Coupe le lien projet ↔ devis Dougs (sans supprimer le devis côté
 * Dougs). Permet de repartir d'un brouillon vide via "Pousser sur Dougs".
 */
export const unlinkProjectDougsQuote = action(
  z.object({ projectId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(projects)
      .set({
        dougsQuoteId: null,
        dougsQuoteReference: null,
        dougsQuoteStatus: null,
        dougsQuotePushedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId));
    revalidatePath(`/projets/${input.projectId}`);
    return { ok: true };
  },
);
