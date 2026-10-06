"use server";

import { and, asc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { resolveInvoiceDocument } from "@/lib/billing/brand-documents";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import { pushDougsSalesInvoiceDraft, resolveDougsClientData } from "@/lib/billing/dougs-push";
import { autoSendCoworkingInvoice, isCoworkingAutoSendEnabled } from "@/lib/coworking/auto-send";
import { generateNextInvoiceForContract } from "@/lib/coworking/generate-invoice";
import { db } from "@/lib/db/server";
import { DougsAuthError, getDougsDraftUrl } from "@/lib/dougs/client";
import {
  createCoworkingContractSchema,
  monthsBetween,
  updateCoworkingContractSchema,
} from "@/lib/schemas/coworking";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

const idSchema = z.object({ id: z.string().uuid() });

// =====================================================================
// Contrats coworking
// =====================================================================

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

// =====================================================================
// Push facture coworking vers Dougs (sales-invoice draft)
// =====================================================================

/**
 * Pousse la facture (invoice kind='coworking') vers Dougs en tant que
 * brouillon. Recherche le client (B2B via entity, B2C via contact),
 * crée le draft, remplit lignes + clientData. Stocke `dougs_invoice_id`
 * sur l'invoice. Ne finalise pas — PY valide depuis Dougs.
 */
export const pushCoworkingInvoiceToDougs = action(idSchema, async ({ input, user }) => {
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
    .where(eq(invoices.id, input.id))
    .limit(1);

  if (!row?.contract) throw new Error("Facture coworking introuvable.");
  const { invoice, contract } = row;
  if (invoice.kind !== "coworking") {
    throw new Error("Cette facture n'est pas de type coworking.");
  }
  if (!invoice.periodStart || !invoice.periodEnd) {
    throw new Error("Période manquante sur la facture.");
  }

  // B2B si le contrat pointe vers une entité, sinon B2C (contact).
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

  const clientData = await resolveDougsClientData({
    userId: user.id,
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
  const terms = await resolveInvoiceDocument(invoice.brand, contract.billingTerms);
  const ctx = {
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

  const draft = await pushDougsSalesInvoiceDraft({
    userId: user.id,
    clientData,
    lines: template.buildLines(ctx),
    subject: template.invoiceSubject(ctx),
    document: terms.document,
  });

  await conn
    .update(invoices)
    .set({
      dougsInvoiceId: draft.id,
      dougsReference: draft.reference,
      dougsStatus: "DRAFT",
      dougsSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, input.id));

  const url = await getDougsDraftUrl(user.id, draft.id);

  revalidateTag(`dougs:${user.id}`, { expire: 0 });
  revalidatePath("/coworking");
  revalidatePath(`/coworking/factures/${input.id}`);
  revalidatePath("/compta");
  return { dougsId: draft.id, reference: draft.reference, url };
});

// =====================================================================
// Envoi automatique
// =====================================================================

/**
 * Interrupteur global de l'envoi automatique. Réservé aux admins : une
 * facture envoyée est irréversible, c'est le geste le plus engageant de
 * l'app.
 *
 * Activer ce réglage ne fait rien partir à lui seul — il faut aussi cocher
 * `auto_send` sur chaque contrat concerné.
 */
export const setCoworkingAutoSendEnabled = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(
      SETTING_KEYS.COWORKING_AUTOSEND_ENABLED,
      input.enabled ? "true" : "false",
      user.id,
    );
    revalidatePath("/settings/integrations");
    revalidatePath("/coworking");
    return { ok: true as const, enabled: input.enabled };
  },
);

/** Opt-in de l'envoi automatique pour un contrat donné. */
export const setCoworkingContractAutoSend = action(
  z.object({ id: z.string().uuid(), autoSend: z.boolean() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(coworkingContracts)
      .set({ autoSend: input.autoSend, updatedAt: new Date() })
      .where(eq(coworkingContracts.id, input.id));
    revalidatePath("/coworking");
    revalidatePath(`/coworking/contrats/${input.id}`);
    revalidatePath("/settings/integrations");
    return { ok: true as const, autoSend: input.autoSend };
  },
);

/**
 * Relance l'envoi d'une facture coworking depuis l'UI, après avoir corrigé
 * un blocage. Même chemin que le cron, donc mêmes garde-fous.
 */
export const retryCoworkingAutoSend = action(idSchema, async ({ input, user }) => {
  const res = await autoSendCoworkingInvoice({ userId: user.id, invoiceId: input.id });
  revalidateTag(`dougs:${user.id}`, { expire: 0 });
  revalidatePath("/coworking");
  revalidatePath(`/coworking/factures/${input.id}`);
  revalidatePath("/compta");
  if (!res.ok) throw new Error(res.message);
  return res.sent
    ? { sent: true as const, reference: res.reference, to: res.to }
    : { sent: false as const, reason: res.reason, blockers: res.blockers ?? [] };
});

/**
 * Factures coworking prêtes à partir, pour affichage avant déclenchement.
 *
 * Chaque contrat a sa propre fréquence : une mensuelle a une facture par mois,
 * une trimestrielle une par trimestre. On ne « facture pas le mois », on envoie
 * ce qui est effectivement dû — d'où une liste qu'on lit avant de cliquer,
 * plutôt qu'un bouton aveugle.
 */
export type DueCoworkingInvoice = {
  invoiceId: string;
  contractName: string;
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  frequency: string;
  amountHt: string;
  recipient: string | null;
  /** Ce qui empêche l'envoi, s'il y a lieu. */
  blocker: string | null;
};

/**
 * Envoie en une fois les factures coworking dues.
 *
 * Remplace la passe d'envoi du cron : l'API Dougs s'authentifie par un cookie
 * de session rafraîchi par l'extension Chrome, donc un envoi déclenché à 6 h du
 * matin sans personne devant la machine est un pari. Déclenché à la main, le
 * cookie est frais par construction.
 *
 * Les garde-fous restent ceux de l'envoi unitaire — réglage global, opt-in par
 * contrat, G&O exclu, destinataire requis — appliqués facture par facture.
 */
export const sendDueCoworkingInvoices = action(z.object({}), async ({ user }) => {
  const enabled = await isCoworkingAutoSendEnabled();
  if (!enabled) throw new Error("L'envoi groupé est désactivé dans les réglages.");

  const conn = await db();
  const queue = await conn
    .select({ id: invoices.id, label: invoices.label, contractName: coworkingContracts.name })
    .from(invoices)
    .innerJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .where(
      and(
        eq(invoices.kind, "coworking"),
        isNull(invoices.autoSentAt),
        eq(coworkingContracts.autoSend, true),
        ne(coworkingContracts.billedBy, "g_and_o"),
        or(
          eq(invoices.status, "draft"),
          // Déjà émise mais le mail n'est pas parti : il reste l'envoi.
          and(eq(invoices.status, "sent"), isNotNull(invoices.dougsInvoiceId)),
        ),
      ),
    )
    .orderBy(asc(invoices.periodStart));

  const sent: Array<{ contractName: string; label: string; reference: string }> = [];
  const blocked: Array<{ contractName: string; label: string; reason: string }> = [];
  const errors: Array<{ contractName: string; label: string; message: string }> = [];

  for (const item of queue) {
    try {
      const res = await autoSendCoworkingInvoice({
        userId: user.id,
        invoiceId: item.id,
        enabled: true,
      });
      if (!res.ok) {
        errors.push({ contractName: item.contractName, label: item.label, message: res.message });
      } else if (res.sent) {
        sent.push({ contractName: item.contractName, label: item.label, reference: res.reference });
      } else {
        blocked.push({
          contractName: item.contractName,
          label: item.label,
          reason:
            res.reason === "blockers"
              ? (res.blockers ?? []).map((b) => b.message).join(" · ")
              : res.reason,
        });
      }
    } catch (err) {
      // Cookie expiré : inutile d'insister sur les suivantes, et c'est
      // exactement la panne qui a fait sortir l'envoi du cron.
      if (err instanceof DougsAuthError) {
        errors.push({ contractName: item.contractName, label: item.label, message: err.message });
        break;
      }
      errors.push({
        contractName: item.contractName,
        label: item.label,
        message: err instanceof Error ? err.message : "erreur inconnue",
      });
    }
  }

  revalidateTag(`dougs:${user.id}`, { expire: 0 });
  revalidatePath("/coworking");
  revalidatePath("/compta");
  return { sent, blocked, errors };
});

/** Qui encaisse les factures de ce contrat. `g_and_o` interdit tout envoi. */
export const setCoworkingContractBilledBy = action(
  z.object({ id: z.string().uuid(), billedBy: z.enum(["parade", "g_and_o"]) }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(coworkingContracts)
      .set({ billedBy: input.billedBy, updatedAt: new Date() })
      .where(eq(coworkingContracts.id, input.id));
    revalidatePath("/coworking");
    revalidatePath(`/coworking/contrats/${input.id}`);
    return { ok: true as const, billedBy: input.billedBy };
  },
);
