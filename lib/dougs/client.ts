import { dougsSessions } from "../../db/schema/dougs";
import { db } from "../db/server";
import { eq } from "drizzle-orm";
import { decryptCookie } from "./crypto";

/**
 * Client server-side pour l'API interne Dougs (`app.dougs.fr`).
 * Auth : cookie de session stocké chiffré par user (cf. crypto.ts).
 *
 * L'API n'est pas publique — usage à risque limité (Parade SAS), pas
 * de garantie de stabilité. Si Dougs change un endpoint, on patche ici.
 */

const BASE = "https://app.dougs.fr";

export class DougsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DougsAuthError";
  }
}

export class DougsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
    this.name = "DougsApiError";
  }
}

type Session = { cookie: string; companyId: string };

async function loadSession(userId: string): Promise<Session | null> {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(dougsSessions)
    .where(eq(dougsSessions.userId, userId))
    .limit(1);
  if (!row) return null;
  return { cookie: decryptCookie(row.cookieEncrypted), companyId: row.companyId };
}

async function touchUsed(userId: string): Promise<void> {
  const conn = await db();
  await conn
    .update(dougsSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(dougsSessions.userId, userId));
}

/**
 * Wrapper fetch authentifié. `pathTemplate` peut contenir
 * `{companyId}` qui sera substitué automatiquement.
 */
async function dougsFetch(
  userId: string,
  pathTemplate: string,
  init?: RequestInit,
): Promise<Response> {
  const session = await loadSession(userId);
  if (!session) {
    throw new DougsAuthError(
      "Aucune session Dougs connectée. Va dans /settings/integrations pour coller ton cookie.",
    );
  }
  const path = pathTemplate.replace("{companyId}", session.companyId);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      Cookie: session.cookie,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new DougsAuthError(
      "Cookie Dougs expiré ou invalide. Va dans /settings/integrations le rafraîchir.",
    );
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`[dougs] ${init?.method ?? "GET"} ${path} → ${res.status}`, body.slice(0, 500));
    throw new DougsApiError(
      `Dougs ${res.status} ${res.statusText} (${init?.method ?? "GET"} ${path})`,
      res.status,
      body.slice(0, 500),
    );
  }
  await touchUsed(userId);
  return res;
}

// ---------- Endpoints utilisés ----------

export type DougsClientSearchResult = {
  isBtoB: boolean;
  isFromPappers: boolean;
  name: string;
  legalName: string | null;
  firstName: string | null;
  lastName: string | null;
  address: { city?: string; zipcode?: string; street?: string } | null;
  email: string | null;
  phone: string | null;
  siren: string | null;
  vatNumber: string | null;
  clientId: string | null;
};

/**
 * Recherche un client (Dougs + Pappers/INSEE). Retourne les meilleurs
 * matches. Si `isBtoB=true`, recherche par nom de société + SIREN ;
 * sinon par nom de personne.
 */
export async function searchDougsClients(
  userId: string,
  name: string,
  isBtoB: boolean,
): Promise<DougsClientSearchResult[]> {
  const path = `/companies/{companyId}/sales-invoices-drafts/clients?isBtoB=${isBtoB}&name=${encodeURIComponent(
    name,
  )}`;
  const res = await dougsFetch(userId, path);
  return res.json();
}

export type DougsSalesInvoiceDraft = {
  id: string;
  reference: string;
  status: string;
  numberPrefix?: string;
  number?: number;
  // ... beaucoup d'autres champs auto-remplis (invoicerOthers, legalData, etc.)
  [key: string]: unknown;
};

/** Crée un brouillon vide. Reference auto-générée. */
export async function createDougsSalesInvoiceDraft(
  userId: string,
): Promise<DougsSalesInvoiceDraft> {
  const res = await dougsFetch(userId, "/companies/{companyId}/sales-invoices-drafts", {
    method: "POST",
    body: "{}",
  });
  return res.json();
}

/**
 * Update d'un draft via PUT sur la ressource "stable" `/sales-invoices/{id}`.
 *
 * Pattern Dougs counter-intuitif : on POST sur `/sales-invoices-drafts`
 * pour créer, mais on PUT sur `/sales-invoices/{id}` pour mettre à jour
 * (même pattern que pour les devis : POST `/quote-drafts`, PUT `/quotes/{id}`).
 *
 * Le payload doit contenir tous les champs : on spread le `draft`
 * renvoyé par createDraft (qui contient déjà invoicerOthers, legalData,
 * date, etc.) puis on overwrite clientData/lines.
 */
export async function updateDougsSalesInvoice(
  userId: string,
  draftId: string,
  payload: Record<string, unknown>,
): Promise<DougsSalesInvoiceDraft> {
  const res = await dougsFetch(userId, `/companies/{companyId}/sales-invoices-drafts/${draftId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteDougsSalesInvoiceDraft(userId: string, draftId: string): Promise<void> {
  await dougsFetch(userId, `/companies/{companyId}/sales-invoices-drafts/${draftId}`, {
    method: "DELETE",
  });
}

/** URL du brouillon dans l'UI Dougs (pour pop-up "voir sur Dougs"). */
export async function getDougsDraftUrl(userId: string, draftId: string): Promise<string> {
  const session = await loadSession(userId);
  if (!session) throw new DougsAuthError("Pas de session Dougs.");
  return `${BASE}/app/c/${session.companyId}/invoicing/sales-invoices/${draftId}`;
}

/**
 * GET d'une facture de vente (draft ou finalisée). Retourne le payload
 * complet incluant `status`, `totalNetAmount`, `totalVatAmount`,
 * `totalAmountWithVat`, `issuedAt`, `paidAt`. Utilisé pour rafraîchir
 * le snapshot Paradeos après push ou via cron.
 */
export type DougsSalesInvoice = {
  id: string;
  reference?: string;
  status?: string;
  totalNetAmount?: number;
  totalVatAmount?: number;
  totalAmountWithVat?: number;
  issuedAt?: string | null;
  paidAt?: string | null;
  [key: string]: unknown;
};

export async function getDougsSalesInvoice(
  userId: string,
  invoiceId: string,
): Promise<DougsSalesInvoice> {
  // Endpoint stable (couvre draft + finalisé).
  const res = await dougsFetch(userId, `/companies/{companyId}/sales-invoices/${invoiceId}`);
  return res.json();
}

// ---------- Devis (quotes) ----------

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

export async function deleteDougsQuoteDraft(userId: string, draftId: string): Promise<void> {
  await dougsFetch(userId, `/companies/{companyId}/invoicing/quote-drafts/${draftId}`, {
    method: "DELETE",
  });
}

/** URL du devis (draft ou finalisé) dans l'UI Dougs. */
export async function getDougsQuoteUrl(userId: string, quoteId: string): Promise<string> {
  const session = await loadSession(userId);
  if (!session) throw new DougsAuthError("Pas de session Dougs.");
  return `${BASE}/app/c/${session.companyId}/invoicing/quotes/${quoteId}`;
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
  [key: string]: unknown;
};

export async function getDougsQuote(userId: string, quoteId: string): Promise<DougsQuote> {
  const res = await dougsFetch(userId, `/companies/{companyId}/invoicing/quotes/${quoteId}`);
  return res.json();
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
 * Liste les factures de vente Dougs (drafts + finalisées).
 */
export type DougsSalesInvoiceListItem = {
  id: string;
  reference?: string | null;
  status?: string | null;
  totalNetAmount?: number | null;
  totalAmountWithVat?: number | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  clientData?: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export async function listDougsSalesInvoices(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DougsSalesInvoiceListItem[]> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices?limit=${limit}&offset=${offset}`,
  );
  return res.json();
}
