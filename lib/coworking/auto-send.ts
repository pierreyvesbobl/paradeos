import "server-only";

/**
 * Envoi automatique d'une facture coworking, de bout en bout : brouillon
 * Dougs → contrôle de finalisabilité → finalisation → mail au coworker.
 *
 * C'est le seul endroit de Parade OS qui finalise une facture sans geste
 * humain. Le choix est assumé pour le coworking seul : le montant est
 * entièrement déterminé par le contrat (postes × prix × durée), donc la
 * validation manuelle ne portait aucune décision. Les devis et les jalons
 * projet, eux, restent non finalisables automatiquement — leur montant se
 * négocie.
 *
 * Deux verrous indépendants doivent être ouverts : le réglage global
 * `COWORKING_AUTOSEND_ENABLED` et le `auto_send` du contrat.
 */

import { contacts as contactsTable } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { tasks } from "@/db/schema/tasks";
import { dueDateFrom } from "@/lib/billing/billing-terms";
import { resolveInvoiceDocument } from "@/lib/billing/brand-documents";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import { deliverDocumentEmail } from "@/lib/billing/deliver-document";
import { pushDougsSalesInvoiceDraft, resolveDougsClientData } from "@/lib/billing/dougs-push";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  type DougsFinalizeBlocker,
  type DougsSalesInvoice,
  canFinalizeDougsSalesInvoice,
  deleteDougsSalesInvoiceDraft,
  finalizeDougsSalesInvoice,
  getDougsSalesInvoice,
  pickDougsHt,
  pickDougsReference,
  pickDougsSalesInvoiceId,
  pickDougsTtc,
  pickDougsVat,
} from "@/lib/dougs/client";

/** Forme minimale acceptée par les pickers de `lib/dougs/client`. */
type DougsPayloadLike = DougsSalesInvoice;
import { monthsBetween } from "@/lib/schemas/coworking";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { type AutoSendSkipReason, autoSendPlan } from "./auto-send-guards";

// Réexport : les appelants (cron, UI) importent tout depuis ce module.
export { type AutoSendSkipReason, autoSendPlan };

export type AutoSendResult =
  | { ok: true; sent: true; reference: string; to: string[] }
  | { ok: true; sent: false; reason: AutoSendSkipReason; blockers?: DougsFinalizeBlocker[] }
  | { ok: false; message: string };

/**
 * Message d'erreur exploitable pour une panne Dougs.
 *
 * `DougsApiError.message` se limite au statut et à l'URL, ce qui ne dit pas
 * *pourquoi* un 400 est un 400. Le corps de la réponse, lui, le dit — et sans
 * lui on débogue à l'aveugle une API non documentée. On le tronque : Dougs
 * renvoie parfois une page entière.
 */
function dougsErrorMessage(err: unknown): string {
  if (err instanceof DougsApiError) {
    const body = err.body?.trim();
    return body ? `${err.message} — ${body.slice(0, 300)}` : err.message;
  }
  return err instanceof Error ? err.message : "erreur inconnue";
}

/** Lu une fois par run de cron plutôt qu'une fois par facture. */
export async function isCoworkingAutoSendEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.COWORKING_AUTOSEND_ENABLED)) === "true";
}

/**
 * Note le blocage sur la facture et crée une tâche pour qu'il atterrisse
 * quelque part. Sans ça, un blocage `can-finalize` ne se verrait qu'en
 * relisant le corps JSON d'un run de cron.
 */
async function recordBlockers(
  invoiceId: string,
  invoiceLabel: string,
  contractName: string,
  assignedTo: string | null,
  blockers: DougsFinalizeBlocker[],
): Promise<void> {
  const conn = await db();
  const summary = blockers.map((b) => `${b.field} : ${b.message}`).join(" / ");
  await conn
    .update(invoices)
    .set({ autoSendError: summary, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  await conn.insert(tasks).values({
    title: `Facture coworking bloquée — ${contractName} (${invoiceLabel})`,
    description: [
      "Dougs refuse de finaliser cette facture automatiquement :",
      "",
      ...blockers.map((b) => `- ${b.field} : ${b.message}`),
      "",
      "Corrige les données du client (ou les réglages de facturation Dougs),",
      "puis relance l'envoi depuis la fiche facture.",
    ].join("\n"),
    priority: "high",
    assigneeId: assignedTo,
    ownerId: assignedTo,
  });
}

/**
 * Pousse, finalise et envoie une facture coworking.
 *
 * L'ordre finalisation → envoi est imposé par l'API : `send-email` n'existe
 * que sur la ressource finalisée. Conséquence assumée : si l'envoi échoue, la
 * facture est émise et numérotée mais `auto_sent_at` reste nul, donc le récap
 * la signale comme « émise, mail non parti » et le renvoi se fait depuis
 * Dougs. L'inverse — envoyer puis finaliser — n'est pas possible.
 */
export async function autoSendCoworkingInvoice(args: {
  userId: string;
  invoiceId: string;
  dryRun?: boolean;
  /** Évite de relire le réglage global pour chaque facture d'un même run. */
  enabled?: boolean;
}): Promise<AutoSendResult> {
  const { userId, invoiceId, dryRun = false } = args;

  const enabled = args.enabled ?? (await isCoworkingAutoSendEnabled());
  if (!enabled) return { ok: true, sent: false, reason: "disabled" };

  const conn = await db();
  const [row] = await conn
    .select({
      invoice: invoices,
      contract: coworkingContracts,
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
      contactEmail: contactsTable.email,
      contactAddress: contactsTable.address,
      entityName: entitiesTable.name,
      entityLegalName: entitiesTable.legalName,
      entitySiren: entitiesTable.siren,
      entitySiret: entitiesTable.siret,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      entityDeliveryAddress: entitiesTable.deliveryAddress,
    })
    .from(invoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(contactsTable, eq(contactsTable.id, coworkingContracts.contactId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, coworkingContracts.billToEntityId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!row || !row.contract) return { ok: false, message: "Facture coworking introuvable." };
  const { invoice, contract } = row;

  if (invoice.kind !== "coworking") {
    return { ok: false, message: "Cette facture n'est pas de type coworking." };
  }
  if (!invoice.periodStart || !invoice.periodEnd) {
    return { ok: false, message: "Période manquante sur la facture." };
  }

  const amountHt = Number(invoice.amountHt);
  const recipient = row.contactEmail?.trim() || null;

  // Gardes. Aucun `skip` n'est une erreur : le cron continue son chemin.
  const plan = autoSendPlan({
    enabled: true,
    contractAutoSend: contract.autoSend,
    billedBy: invoice.billedBy,
    autoSentAt: invoice.autoSentAt,
    dougsStatus: invoice.dougsStatus,
    amountHt,
    recipientEmail: recipient,
  });
  if (plan.kind === "skip") return { ok: true, sent: false, reason: plan.reason };

  const isBtoB = Boolean(contract.billToEntityId);
  const clientName = isBtoB
    ? (row.entityLegalName ?? row.entityName ?? "")
    : `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim();
  if (!clientName) {
    return {
      ok: false,
      message: isBtoB
        ? "Entité de facturation manquante ou supprimée."
        : "Contact manquant (impossible de facturer au nom du particulier).",
    };
  }

  // --- Contenu, depuis le template de la marque. ---
  const template = brandTemplateFor(invoice.brand);
  // Conditions négociées sur ce contrat, par-dessus les défauts de la marque.
  const terms = await resolveInvoiceDocument(invoice.brand, contract.billingTerms);
  const months = monthsBetween(invoice.periodStart, invoice.periodEnd);
  const ctx = {
    label: invoice.label,
    amountHt,
    vatRate: Number(invoice.vatRate),
    clientName,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    months,
    desks: invoice.desks ?? contract.desks,
    unitPriceHt: Number(invoice.unitPriceHt ?? contract.unitPriceHt),
  };
  const lines = template.buildLines(ctx);
  const mail = template.email(ctx);

  // --- Facture déjà émise, mail jamais parti : il ne reste que l'envoi. ---
  if (plan.kind === "email_only") {
    if (!invoice.dougsInvoiceId) {
      return { ok: false, message: "Facture marquée émise mais sans identifiant Dougs." };
    }
    const reference = invoice.dougsReference ?? invoice.dougsInvoiceId;
    try {
      await deliverDocumentEmail({
        userId,
        documentId: invoice.dougsInvoiceId,
        documentKind: "invoice",
        archiveInvoiceId: invoice.id,
        clientName,
        recipient: recipient as string,
        reference,
        brand: invoice.brand,
        mail,
      });
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      const message = dougsErrorMessage(err);
      await conn
        .update(invoices)
        .set({ autoSendError: `Mail non envoyé : ${message}`, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
      return { ok: false, message: `Facture ${reference} émise, mail non envoyé : ${message}` };
    }
    await conn
      .update(invoices)
      .set({ autoSentAt: new Date(), autoSendError: null, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    return { ok: true, sent: true, reference, to: [recipient as string] };
  }

  // --- Dougs. ---

  // Brouillon laissé par une tentative précédente (blocage can-finalize, ou
  // push manuel non finalisé) : on le supprime avant d'en créer un nouveau,
  // sinon chaque relance laisse un orphelin de plus chez Dougs. Sans risque
  // de perte : les gardes ci-dessus ont déjà écarté tout ce qui est sorti du
  // brouillon, et on réécrit de toute façon lignes et client depuis le
  // template. Un échec de suppression n'interrompt rien.
  if (invoice.dougsInvoiceId) {
    try {
      await deleteDougsSalesInvoiceDraft(userId, invoice.dougsInvoiceId);
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      console.warn(
        `[auto-send] brouillon ${invoice.dougsInvoiceId} non supprimé :`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  let draft: { id: string; reference: string };
  try {
    const clientData = await resolveDougsClientData({
      userId,
      isBtoB,
      searchName: isBtoB ? (row.entityName ?? clientName) : clientName,
      local: {
        legalName: row.entityLegalName ?? row.entityName ?? null,
        siren: row.entitySiren ?? null,
        siret: row.entitySiret ?? null,
        vatNumber: row.entityVatNumber ?? null,
        firstName: row.contactFirstName ?? null,
        lastName: row.contactLastName ?? null,
        address: isBtoB ? row.entityAddress : row.contactAddress,
        deliveryAddress: isBtoB ? row.entityDeliveryAddress : null,
        email: recipient,
      },
    });
    draft = await pushDougsSalesInvoiceDraft({
      userId,
      clientData,
      lines,
      subject: template.invoiceSubject(ctx),
      document: terms.document,
    });
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    return { ok: false, message: dougsErrorMessage(err) };
  }

  // Le brouillon existe : on le trace tout de suite, pour qu'un échec plus
  // loin ne laisse pas un brouillon orphelin chez Dougs sans trace locale.
  await conn
    .update(invoices)
    .set({
      dougsInvoiceId: draft.id,
      dougsReference: draft.reference,
      dougsStatus: "DRAFT",
      dougsSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  let blockers: DougsFinalizeBlocker[];
  try {
    blockers = await canFinalizeDougsSalesInvoice(userId, draft.id);
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    return { ok: false, message: `Contrôle can-finalize : ${dougsErrorMessage(err)}` };
  }

  if (blockers.length > 0) {
    await recordBlockers(
      invoiceId,
      invoice.label,
      contract.name,
      invoice.assignedTo ?? contract.createdBy ?? null,
      blockers,
    );
    return { ok: true, sent: false, reason: "blockers", blockers };
  }

  if (dryRun) {
    // Ne rien laisser traîner chez Dougs : un run à blanc ne doit pas se
    // distinguer d'un run qui n'a pas eu lieu.
    try {
      await deleteDougsSalesInvoiceDraft(userId, draft.id);
      await conn
        .update(invoices)
        .set({
          dougsInvoiceId: null,
          dougsReference: null,
          dougsStatus: null,
          dougsSyncedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId));
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      // Le brouillon reste chez Dougs : signalé, pas masqué.
      return {
        ok: false,
        message: `À blanc : brouillon ${draft.reference} non supprimé (${dougsErrorMessage(err)}).`,
      };
    }
    return { ok: true, sent: false, reason: "dry_run" };
  }

  // --- Point de non-retour. ---
  let finalReference = draft.reference;
  // À la finalisation, Dougs attribue à la facture un **id différent de celui
  // du brouillon**. Garder l'id du brouillon fait échouer tout ce qui suit
  // (`send-email` renvoie 400) et laisse en base un identifiant qui ne désigne
  // plus la facture émise.
  let finalInvoiceId = draft.id;
  try {
    const finalized = await finalizeDougsSalesInvoice(userId, draft.id);
    // `finalized.id` est l'id du **brouillon** : s'en servir fait répondre 404
    // à `send-email`. Le bon est `salesInvoiceId`.
    finalInvoiceId = pickDougsSalesInvoiceId(finalized) ?? finalInvoiceId;
    finalReference = pickDougsReference(finalized) ?? finalReference;
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    return { ok: false, message: `Finalisation Dougs : ${dougsErrorMessage(err)}` };
  }

  const invoicedAt = new Date();
  const dueDate = dueDateFrom(invoicedAt, terms.dueDays);

  // Relecture : la facture finalisée porte la référence définitive et les
  // totaux calculés par Dougs, qui font foi sur les nôtres.
  let totals: { ht: number | null; vat: number | null; ttc: number | null } = {
    ht: null,
    vat: null,
    ttc: null,
  };
  /** Réutilisé pour y lire l'UUID du PDF, plutôt que de redemander la facture. */
  let freshPayload: DougsPayloadLike | null = null;
  try {
    const fresh = await getDougsSalesInvoice(userId, finalInvoiceId);
    freshPayload = fresh;
    finalReference = pickDougsReference(fresh) ?? finalReference;
    totals = { ht: pickDougsHt(fresh), vat: pickDougsVat(fresh), ttc: pickDougsTtc(fresh) };
  } catch {
    // La facture est émise : une relecture ratée ne doit pas bloquer l'envoi.
    // Le cron `sync-dougs-status` rattrapera le snapshot le lendemain.
  }

  await conn
    .update(invoices)
    .set({
      status: "sent",
      invoicedAt,
      dueDate: toIsoDate(dueDate),
      dougsInvoiceId: finalInvoiceId,
      dougsReference: finalReference,
      dougsStatus: "WAITING",
      dougsTotalHt: toNumeric(totals.ht),
      dougsTotalVat: toNumeric(totals.vat),
      dougsTotalTtc: toNumeric(totals.ttc),
      dougsIssuedAt: invoicedAt,
      dougsSyncedAt: new Date(),
      autoSendError: null,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  try {
    await deliverDocumentEmail({
      userId,
      documentId: finalInvoiceId,
      documentKind: "invoice",
      archiveInvoiceId: invoice.id,
      clientName,
      recipient: recipient as string,
      reference: finalReference,
      brand: invoice.brand,
      mail,
      payload: freshPayload,
    });
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    const message = dougsErrorMessage(err);
    await conn
      .update(invoices)
      .set({ autoSendError: `Mail non envoyé : ${message}`, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    return {
      ok: false,
      message: `Facture ${finalReference} émise mais mail non envoyé : ${message}`,
    };
  }

  await conn
    .update(invoices)
    .set({ autoSentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  return { ok: true, sent: true, reference: finalReference, to: [recipient as string] };
}

function toNumeric(n: number | null): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : null;
}

/** `invoices.due_date` est une colonne `date`, pas un timestamp. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
