"use server";

import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { resolveInvoiceDocument } from "@/lib/billing/brand-documents";
import { buildDocumentPatch, resolveDougsClientData } from "@/lib/billing/dougs-push";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  createDougsQuoteDraft,
  getDougsQuoteDraft,
  getDougsQuoteUrl,
  updateDougsQuote,
} from "@/lib/dougs/client";
import { and, eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
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
 * Le devis est stocké côté Paradeos dans `invoices` avec kind='quote'
 * (1 par projet). Ne **finalise pas** côté Dougs : PY valide et envoie
 * depuis l'UI Dougs.
 */
export const pushProjectQuoteToDougs = action(pushSchema, async ({ input, user }) => {
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
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
      contactEmail: contactsTable.email,
      projectBillingTerms: projects.billingTerms,
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

  // Quote invoice : 1 par projet (kind='quote').
  const [existingQuote] = await conn
    .select({
      id: invoices.id,
      dougsQuoteId: invoices.dougsQuoteId,
      dougsStatus: invoices.dougsStatus,
    })
    .from(invoices)
    .where(and(eq(invoices.projectId, input.projectId), eq(invoices.kind, "quote")))
    .limit(1);

  // Projets client = B2B par construction (entityId requis).
  const isBtoB = true;

  const clientData = await resolveDougsClientData({
    userId: user.id,
    isBtoB,
    searchName: row.entityName,
    local: {
      legalName: row.entityLegalName ?? row.entityName,
      siren: row.entitySiren ?? null,
      siret: row.entitySiret ?? null,
      vatNumber: row.entityVatNumber ?? null,
      firstName: row.contactFirstName ?? null,
      lastName: row.contactLastName ?? null,
      address: row.entityAddress,
      deliveryAddress: row.entityDeliveryAddress,
      email: row.contactEmail ?? null,
    },
  });

  // Un devis relève d'Automato, et doit porter les mêmes mentions que les
  // factures du projet : logo de la marque, sous-titre émetteur, modalités de
  // paiement négociées, mentions de pied. Sans ça, un devis empruntait le logo
  // par défaut de la société — donc celui d'une autre marque dès qu'on le
  // changeait.
  //
  // `dueDateOption` est écarté : un devis a une date d'expiration, pas une
  // échéance de paiement.
  const terms = await resolveInvoiceDocument("automato", row.projectBillingTerms);
  const { dueDateOption: _ignoré, ...quoteDocument } = terms.document;

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
    const existingDougsId = existingQuote?.dougsQuoteId ?? null;
    if (existingDougsId && (existingQuote?.dougsStatus ?? "DRAFT") === "DRAFT") {
      const current = await getDougsQuoteDraft(user.id, existingDougsId);
      const updated = await updateDougsQuote(user.id, existingDougsId, {
        ...current,
        ...buildDocumentPatch(current as unknown as Record<string, unknown>, quoteDocument),
        subject: input.subject,
        // La note saisie dans le formulaire fait foi ; vide, on retombe sur
        // celle de la marque ou du deal.
        thankYouNote: input.thankYouNote || (quoteDocument.thankYouNote ?? ""),
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
        ...buildDocumentPatch(draft as unknown as Record<string, unknown>, quoteDocument),
        subject: input.subject,
        thankYouNote: input.thankYouNote || (quoteDocument.thankYouNote ?? ""),
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

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const updateValues = {
    label: `Devis ${project.name}`,
    amountHt: total.toFixed(2),
    vatRate: "0.2",
    status: "sent" as const,
    dougsQuoteId: quoteId,
    dougsReference: reference,
    dougsStatus: status,
    invoicedAt: new Date(),
    dougsSyncedAt: new Date(),
    updatedAt: new Date(),
  };

  if (existingQuote) {
    await conn.update(invoices).set(updateValues).where(eq(invoices.id, existingQuote.id));
  } else {
    await conn.insert(invoices).values({
      kind: "quote",
      projectId: input.projectId,
      createdBy: user.id,
      ...updateValues,
    });
  }

  const url = await getDougsQuoteUrl(user.id, quoteId);
  // Bust le cache Dougs (lib/dougs/cache.ts) : le push crée un nouveau
  // brouillon côté Dougs, la liste cached ne le contient pas encore.
  revalidateTag(`dougs:${user.id}`);
  revalidatePath(`/projets/${input.projectId}`);
  return { dougsId: quoteId, reference, status, url };
});

/**
 * Coupe le lien projet ↔ devis Dougs (sans supprimer le devis côté
 * Dougs). Efface le snapshot mais garde l'invoice row pour pouvoir
 * re-pusher. Si tu veux complètement supprimer le devis local, utilise
 * deleteInvoice depuis lib/actions/invoices.ts.
 */
export const unlinkProjectDougsQuote = action(
  z.object({ projectId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(invoices)
      .set({
        dougsQuoteId: null,
        dougsReference: null,
        dougsStatus: null,
        dougsTotalHt: null,
        dougsTotalVat: null,
        dougsTotalTtc: null,
        dougsIssuedAt: null,
        dougsSyncedAt: null,
        status: "draft",
        invoicedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.projectId, input.projectId), eq(invoices.kind, "quote")));
    revalidatePath(`/projets/${input.projectId}`);
    revalidatePath("/compta");
    return { ok: true };
  },
);
