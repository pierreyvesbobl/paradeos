"use server";

import { contacts as contactsTable } from "@/db/schema/contacts";
import { coworkingContracts, coworkingInvoices } from "@/db/schema/coworking";
import { entities as entitiesTable } from "@/db/schema/entities";
import { action } from "@/lib/actions/action";
import { generateNextInvoiceForContract } from "@/lib/coworking/generate-invoice";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  createDougsSalesInvoiceDraft,
  getDougsDraftUrl,
  searchDougsClients,
  updateDougsSalesInvoice,
} from "@/lib/dougs/client";
import {
  createCoworkingContractSchema,
  createCoworkingInvoiceSchema,
  monthsBetween,
  updateCoworkingContractSchema,
  updateCoworkingInvoiceSchema,
} from "@/lib/schemas/coworking";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const idSchema = z.object({ id: z.string().uuid() });

// ---------- Contrats ----------

export const createCoworkingContract = action(
  createCoworkingContractSchema,
  async ({ input, user }) => {
    const conn = await db();
    const [row] = await conn
      .insert(coworkingContracts)
      .values({
        name: input.name,
        contactId: input.contactId ?? null,
        billToEntityId: input.billToEntityId ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        desks: input.desks,
        unitPriceHt: input.unitPriceHt,
        status: input.status ?? "en_cours",
        billingFrequency: input.billingFrequency ?? "quarterly",
        notes: input.notes ?? null,
        createdBy: user.id,
      })
      .returning({ id: coworkingContracts.id });

    revalidatePath("/coworking");
    return { id: row?.id };
  },
);

/**
 * Génère la facture suivante pour un contrat (bouton manuel).
 * `forceFuture=true` : on crée même si la période est dans le futur.
 * Côté cron, le helper est appelé avec `forceFuture=false`.
 */
export const generateNextCoworkingInvoice = action(
  z.object({ contractId: z.string().uuid() }),
  async ({ input, user }) => {
    const res = await generateNextInvoiceForContract({
      contractId: input.contractId,
      createdBy: user.id,
      forceFuture: true,
    });
    if (!res.ok) throw new Error(res.message);
    if (!res.created) throw new Error("Génération impossible (contrat terminé ou introuvable).");

    revalidatePath("/coworking");
    revalidatePath(`/coworking/contrats/${input.contractId}`);
    return { id: res.id };
  },
);

export const updateCoworkingContract = action(updateCoworkingContractSchema, async ({ input }) => {
  const conn = await db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) update.name = input.name;
  if (input.contactId !== undefined) update.contactId = input.contactId;
  if (input.billToEntityId !== undefined) update.billToEntityId = input.billToEntityId;
  if (input.startDate !== undefined) update.startDate = input.startDate;
  if (input.endDate !== undefined) update.endDate = input.endDate;
  if (input.desks !== undefined) update.desks = input.desks;
  if (input.unitPriceHt !== undefined) update.unitPriceHt = input.unitPriceHt;
  if (input.status !== undefined) update.status = input.status;
  if (input.billingFrequency !== undefined) update.billingFrequency = input.billingFrequency;
  if (input.notes !== undefined) update.notes = input.notes;

  await conn.update(coworkingContracts).set(update).where(eq(coworkingContracts.id, input.id));

  revalidatePath("/coworking");
  revalidatePath(`/coworking/contrats/${input.id}`);
  return { id: input.id };
});

export const deleteCoworkingContract = action(idSchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(coworkingContracts).where(eq(coworkingContracts.id, input.id));
  revalidatePath("/coworking");
  return { id: input.id };
});

// ---------- Factures ----------

export const createCoworkingInvoice = action(
  createCoworkingInvoiceSchema,
  async ({ input, user }) => {
    const conn = await db();
    const [row] = await conn
      .insert(coworkingInvoices)
      .values({
        contractId: input.contractId,
        name: input.name,
        invoiceDate: input.invoiceDate ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? "a_facturer",
        billedBy: input.billedBy ?? "parade",
        desks: input.desks,
        unitPriceHt: input.unitPriceHt,
        vatRate: input.vatRate ?? "0.2",
        notes: input.notes ?? null,
        createdBy: user.id,
      })
      .returning({ id: coworkingInvoices.id });

    revalidatePath("/coworking");
    revalidatePath(`/coworking/contrats/${input.contractId}`);
    return { id: row?.id };
  },
);

export const updateCoworkingInvoice = action(updateCoworkingInvoiceSchema, async ({ input }) => {
  const conn = await db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) update.name = input.name;
  if (input.invoiceDate !== undefined) update.invoiceDate = input.invoiceDate;
  if (input.periodStart !== undefined) update.periodStart = input.periodStart;
  if (input.periodEnd !== undefined) update.periodEnd = input.periodEnd;
  if (input.status !== undefined) update.status = input.status;
  if (input.billedBy !== undefined) update.billedBy = input.billedBy;
  if (input.desks !== undefined) update.desks = input.desks;
  if (input.unitPriceHt !== undefined) update.unitPriceHt = input.unitPriceHt;
  if (input.vatRate !== undefined) update.vatRate = input.vatRate;
  if (input.notes !== undefined) update.notes = input.notes;

  await conn.update(coworkingInvoices).set(update).where(eq(coworkingInvoices.id, input.id));

  revalidatePath("/coworking");
  revalidatePath(`/coworking/factures/${input.id}`);
  return { id: input.id };
});

export const deleteCoworkingInvoice = action(idSchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(coworkingInvoices).where(eq(coworkingInvoices.id, input.id));
  revalidatePath("/coworking");
  return { id: input.id };
});

// ---------- Dougs : push d'une facture en brouillon ----------

/**
 * Pousse la facture Paradeos vers Dougs en tant que brouillon
 * `sales-invoices-drafts`. Recherche le client (par entity.name si B2B,
 * sinon par contact.firstName+lastName), crée le draft, remplit lignes
 * et clientData. Stocke le `dougs_invoice_id` retourné.
 *
 * Ne **finalise pas** le brouillon — c'est PY qui valide depuis Dougs.
 */
export const pushCoworkingInvoiceToDougs = action(idSchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .select({
      invoice: coworkingInvoices,
      contract: coworkingContracts,
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
      contactEmail: contactsTable.email,
      // Entité de facturation (B2B) — pilote isBtoB + clientData.
      billToEntityName: entitiesTable.name,
      billToEntitySiren: entitiesTable.siren,
      billToEntityVatNumber: entitiesTable.vatNumber,
      billToEntityAddress: entitiesTable.address,
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(contactsTable, eq(contactsTable.id, coworkingContracts.contactId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, coworkingContracts.billToEntityId))
    .where(eq(coworkingInvoices.id, input.id))
    .limit(1);

  if (!row || !row.contract) throw new Error("Facture introuvable.");
  const { invoice, contract } = row;

  // B2B si le contrat pointe sur une entité de facturation, sinon B2C
  // (au nom du contact qui occupe le poste).
  const isBtoB = Boolean(contract.billToEntityId);
  const searchName = isBtoB
    ? (row.billToEntityName ?? "")
    : `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim();

  if (!searchName) {
    throw new Error(
      isBtoB
        ? "Entité de facturation manquante ou supprimée."
        : "Contact manquant (impossible de générer la facture au nom du particulier).",
    );
  }

  let clientData: Record<string, unknown>;
  try {
    const matches = await searchDougsClients(user.id, searchName, isBtoB);
    const best = matches[0];
    if (best) {
      // Match trouvé (Dougs existant ou Pappers).
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
      // Pas de match — payload minimal depuis nos données locales.
      const addr = row.billToEntityAddress as {
        street?: string;
        postalCode?: string;
        city?: string;
        country?: string;
      } | null;
      clientData = {
        isBToB: isBtoB,
        legalName: isBtoB ? row.billToEntityName : null,
        siren: row.billToEntitySiren ?? null,
        siret: null,
        vatNumber: row.billToEntityVatNumber ?? null,
        firstName: isBtoB ? null : row.contactFirstName,
        lastName: isBtoB ? null : row.contactLastName,
        address: {
          street: addr?.street ?? "",
          zipCode: addr?.postalCode ?? "",
          city: addr?.city ?? "",
          country: addr?.country ?? "France",
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

  const months = monthsBetween(invoice.periodStart, invoice.periodEnd);
  const desks = contract.desks;
  const monthlyHt = Number(contract.unitPriceHt);
  const vatRate = Number(invoice.vatRate);

  const lines = [
    {
      title: `Location coworking — ${invoice.name}`,
      description: `${desks} poste${desks > 1 ? "s" : ""} × ${monthlyHt.toLocaleString("fr-FR")} €/mois × ${months} mois (${invoice.periodStart} → ${invoice.periodEnd})`,
      unit: "mois",
      quantity: months,
      unitAmount: desks * monthlyHt,
      vatRate,
      discount: 0,
      discountUnit: "%",
      reference: null,
      amount: desks * monthlyHt * months,
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

  await conn
    .update(coworkingInvoices)
    .set({ dougsInvoiceId: draft.id, updatedAt: new Date() })
    .where(eq(coworkingInvoices.id, input.id));

  const url = await getDougsDraftUrl(user.id, draft.id);

  revalidatePath("/coworking");
  revalidatePath(`/coworking/factures/${input.id}`);
  return { dougsId: draft.id, reference: draft.reference, url };
});
