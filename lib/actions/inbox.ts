"use server";

import {
  acceptEmailProposal,
  rejectEmailProposal,
  revertEmailProposal,
  updateAcceptedEmailProposal,
} from "@/lib/actions/email-proposals";
import { rejectInvoiceFiling, retryInvoiceFiling } from "@/lib/actions/invoice-filings";
import {
  linkInvoiceToDougs,
  linkProjectAsNewMilestone,
  linkProjectQuoteToDougs,
} from "@/lib/actions/invoices";
import { decideProposal, revertProposal, updateAcceptedProposal } from "@/lib/actions/meetings";
import { getUser } from "@/lib/auth/server";
import type { InboxReconciliation } from "@/lib/db/queries/inbox";
import {
  type InboxHistoryData,
  type InboxHistoryFilters,
  type InboxHistorySource,
  getInboxHistory,
} from "@/lib/db/queries/inbox-history";
import { type InboxPreview, getInboxPreview } from "@/lib/db/queries/inbox-preview";

/**
 * Dispatcher unique appelé depuis /inbox : choisit l'action métier
 * selon la source de l'item. Pas de nouveau schéma Zod — chaque action
 * sous-jacente valide sa propre entrée.
 *
 * Sémantique de `accept` par source :
 *   - email          → acceptEmailProposal (crée le record CRM)
 *   - meeting        → decideProposal(action=accept)
 *   - filing         → retryInvoiceFiling (relance le classement auto)
 *   - reconciliation → linkInvoiceToDougs / linkProjectQuoteToDougs /
 *                      linkProjectAsNewMilestone selon le sous-type
 *
 * `payloadOverride` permet à /inbox de proposer une édition inline
 * avant validation (merge sur le payload existant). Ignoré pour filing
 * et reconciliation qui n'ont pas de payload éditable.
 *
 * `reject` :
 *   - email / meeting / filing → marque comme rejeté côté serveur
 *   - reconciliation → no-op côté serveur (dismiss local uniquement)
 */
export async function decideInboxItem(input: {
  source: "email" | "meeting" | "filing" | "reconciliation";
  id: string;
  action: "accept" | "reject";
  payloadOverride?: Record<string, unknown> | null;
  reconciliation?: InboxReconciliation | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.source === "email") {
    if (input.action === "accept") {
      const res = await acceptEmailProposal({
        proposalId: input.id,
        payloadOverride: input.payloadOverride ?? null,
      });
      if (!res.ok) return { ok: false, message: res.message };
      return { ok: true };
    }
    const res = await rejectEmailProposal({ proposalId: input.id });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  if (input.source === "meeting") {
    const res = await decideProposal({
      proposalId: input.id,
      action: input.action,
      payloadOverride:
        input.action === "accept" && input.payloadOverride ? input.payloadOverride : undefined,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  if (input.source === "reconciliation") {
    // Reject : rien à faire côté serveur — la suggestion réapparaîtra
    // au prochain refresh si toujours pas liée. Le dismiss local suffit
    // pour la session courante.
    if (input.action === "reject") return { ok: true };
    const reco = input.reconciliation;
    if (!reco) return { ok: false, message: "Payload rapprochement manquant." };
    if (reco.action === "link_invoice_to_dougs") {
      const res = await linkInvoiceToDougs({
        invoiceId: reco.targetId,
        dougsIdOrUrl: reco.dougsId,
      });
      if (!res.ok) return { ok: false, message: res.message };
      return { ok: true };
    }
    if (reco.action === "link_project_quote_to_dougs") {
      const res = await linkProjectQuoteToDougs({
        projectId: reco.targetId,
        dougsIdOrUrl: reco.dougsId,
      });
      if (!res.ok) return { ok: false, message: res.message };
      return { ok: true };
    }
    // link_project_as_new_milestone
    const res = await linkProjectAsNewMilestone({
      projectId: reco.targetId,
      dougsIdOrUrl: reco.dougsId,
      detectedPercent: reco.detectedPercent ?? null,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  const fn = input.action === "accept" ? retryInvoiceFiling : rejectInvoiceFiling;
  const res = await fn({ filingId: input.id });
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true };
}

/**
 * Charge l'aperçu d'un item de l'inbox à la demande (au clic sur la
 * ligne). Retourne null si l'item n'appartient pas au user courant ou
 * s'il a été supprimé entre-temps.
 */
export async function loadInboxPreview(input: {
  source: "email" | "meeting" | "filing";
  sourceId: string;
}): Promise<InboxPreview | null> {
  return getInboxPreview(input.source, input.sourceId);
}

/**
 * Historique de l'inbox — chargement paginé côté client (filtres +
 * « afficher plus » sans navigation).
 */
export async function loadInboxHistory(
  filters: InboxHistoryFilters,
): Promise<InboxHistoryData | null> {
  const user = await getUser();
  if (!user) return null;
  return getInboxHistory(user.id, filters);
}

/**
 * Remet une décision en attente : l'item repart dans « À traiter ».
 *
 * Sémantique par source :
 *   - email   → revertEmailProposal. Pour un rattachement, la décision
 *               EST la liaison : la remettre en attente efface la
 *               liaison et son label Gmail, dans un sens comme dans
 *               l'autre. Les records créés (tâche, contact…) ne sont
 *               pas supprimés.
 *   - meeting → revertProposal, même principe.
 *   - filing  → retryInvoiceFiling : un classement ne se « dé-décide »
 *               pas, il se relance (repasse pending puis reclasse).
 */
export async function revertInboxItem(input: {
  source: InboxHistorySource;
  id: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.source === "email") {
    const res = await revertEmailProposal({ proposalId: input.id });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  if (input.source === "meeting") {
    const res = await revertProposal({ proposalId: input.id });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  const res = await retryInvoiceFiling({ filingId: input.id });
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true };
}

/**
 * Corrige le record créé par une proposition déjà acceptée (mauvais
 * titre, mauvaise entité…) sans revert + re-accept, qui créerait un
 * doublon. Les classements de facture n'ont pas de payload éditable.
 */
export async function updateInboxHistoryItem(input: {
  source: InboxHistorySource;
  id: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.source === "email") {
    const res = await updateAcceptedEmailProposal({
      proposalId: input.id,
      payload: input.payload,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  if (input.source === "meeting") {
    const res = await updateAcceptedProposal({ proposalId: input.id, payload: input.payload });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }
  return { ok: false, message: "Un classement de facture ne s'édite pas — relance-le." };
}
