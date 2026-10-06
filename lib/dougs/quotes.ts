import { DougsApiError, DougsAuthError, dougsFetch, loadSession } from "./http";
import { buildDougsQuoteUrl } from "./sales-invoices";

export type DougsQuoteDraft = {
  id: string;
  reference: string;
  status: string;
  numberPrefix?: string;
  number?: number;
  // ... autres champs auto-remplis (invoicerOthers, legalData, dates, etc.)
  [key: string]: unknown;
};

/**
 * Crée un brouillon de devis vide. Référence auto (`numberPrefix` +
 * `number`), date du jour, expiration 30j, données légales pré-remplies.
 */
export async function createDougsQuoteDraft(userId: string): Promise<DougsQuoteDraft> {
  const res = await dougsFetch(userId, "/companies/{companyId}/invoicing/quote-drafts", {
    method: "POST",
    body: "{}",
  });
  return res.json();
}

/**
 * GET du brouillon courant — utile pour récupérer les champs auto-remplis
 * (invoicerOthers, legalData) avant un PUT, sans les écraser.
 */
export async function getDougsQuoteDraft(
  userId: string,
  draftId: string,
): Promise<DougsQuoteDraft> {
  const res = await dougsFetch(userId, `/companies/{companyId}/invoicing/quote-drafts/${draftId}`);
  return res.json();
}

/**
 * Update d'un devis via PUT sur la ressource stable `/invoicing/quotes/{id}`
 * (et non `/quote-drafts/{id}`, qui ne sert qu'à la création/finalize).
 * Le payload doit contenir tous les champs : spread du draft renvoyé par
 * `getDougsQuoteDraft` puis overwrite clientData / lines / subject /
 * thankYouNote. Les totaux sont recalculés côté serveur.
 */
export async function updateDougsQuote(
  userId: string,
  quoteId: string,
  payload: Record<string, unknown>,
): Promise<DougsQuoteDraft> {
  const res = await dougsFetch(userId, `/companies/{companyId}/invoicing/quotes/${quoteId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return res.json();
}

/**
 * Finalise un devis : il sort du brouillon, reçoit son numéro définitif et
 * passe en attente de réponse du client.
 *
 * Noter le verbe : **PUT** pour un devis, là où une facture de vente utilise un
 * POST. Moins engageant qu'une facture — un devis ne consomme pas la séquence
 * comptable — mais le numéro est tout de même attribué.
 */
export async function finalizeDougsQuote(userId: string, draftId: string): Promise<DougsQuote> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/invoicing/quote-drafts/${draftId}/actions/finalize`,
    { method: "PUT", body: "{}", timeoutMs: 20000 },
  );
  return res.json();
}

export async function deleteDougsQuoteDraft(userId: string, draftId: string): Promise<void> {
  await dougsFetch(userId, `/companies/{companyId}/invoicing/quote-drafts/${draftId}`, {
    method: "DELETE",
  });
}

/** URL du devis (draft ou finalisé) dans l'UI Dougs. */
export async function getDougsQuoteUrl(userId: string, quoteId: string): Promise<string> {
  const session = await loadSession(userId);
  if (!session) throw new DougsAuthError("Pas de session Dougs.");
  return buildDougsQuoteUrl(session.companyId, quoteId);
}

/**
 * GET d'un devis (draft ou finalisé). Endpoint stable
 * `/invoicing/quotes/{id}` (le pendant `/quote-drafts/{id}` n'existe
 * qu'en draft). Retourne `status` (DRAFT/PENDING/ACCEPTED/REFUSED),
 * `totalNetAmount`, `totalVatAmount`, `totalAmountWithVat`, `issuedAt`.
 */
export type DougsQuote = {
  id: string;
  reference?: string;
  status?: string;
  totalNetAmount?: number;
  totalVatAmount?: number;
  totalAmountWithVat?: number;
  issuedAt?: string | null;
  createdAt?: string | null;
  clientData?: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export async function getDougsQuote(userId: string, quoteId: string): Promise<DougsQuote> {
  // Fallback drafts si 404 sur l'endpoint stable (idem sales-invoices).
  try {
    const res = await dougsFetch(userId, `/companies/{companyId}/invoicing/quotes/${quoteId}`);
    return res.json();
  } catch (err) {
    if (err instanceof DougsApiError && err.status === 404) {
      const res = await dougsFetch(
        userId,
        `/companies/{companyId}/invoicing/quote-drafts/${quoteId}`,
      );
      return res.json();
    }
    throw err;
  }
}

/**
 * Liste les devis Dougs (drafts + finalisés). Utilisé par la page de
 * rapprochement. Pagination simple via limit/offset.
 */
export type DougsQuoteListItem = {
  id: string;
  reference?: string | null;
  status?: string | null;
  totalNetAmount?: number | null;
  totalAmountWithVat?: number | null;
  issuedAt?: string | null;
  createdAt?: string | null;
  clientData?: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export async function listDougsQuotes(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DougsQuoteListItem[]> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/invoicing/quotes?limit=${limit}&offset=${offset}`,
  );
  return res.json();
}

/**
 * Liste les factures clients Dougs (drafts + finalisées).
 */
