import { eq } from "drizzle-orm";
import { dougsSessions } from "../../db/schema/dougs";
import { db } from "../db/server";
import { fetchWithTimeout } from "../net/fetch-with-timeout";
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
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      Cookie: session.cookie,
    },
    // Dougs derrière Cloudflare → si Cloudflare met du temps à répondre,
    // sans borne la page reste ouverte jusqu'à la limite Vercel. 8 s :
    // un peu plus que Drive parce que Dougs est régulièrement lent sur
    // les list endpoints, mais assez court pour ne pas bloquer l'UI.
    timeoutMs: 8000,
    label: `Dougs ${init?.method ?? "GET"} ${pathTemplate}`,
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

/**
 * URL de la facture dans l'UI Dougs. Pattern Angular Dougs (vérifié
 * 2026-05) : query params, pas path segments. `salesInvoiceId` ouvre
 * la modal de détail ; `status` détermine quel onglet est actif quand
 * l'utilisateur ferme la modal (waiting / paid / late / draft).
 */
export function buildDougsInvoiceUrl(
  companyId: string,
  invoiceId: string,
  opts: { status?: "waiting" | "paid" | "late" | "draft" | null } = {},
): string {
  const status = opts.status ?? "waiting";
  return `${BASE}/app/c/${companyId}/invoicing/sales-invoice?status=${status}&salesInvoiceId=${invoiceId}`;
}

/**
 * URL du devis dans l'UI Dougs. Pattern symétrique aux factures
 * clients. Pour l'instant on suppose `quoteId` + `status` (draft /
 * pending / accepted / refused).
 */
export function buildDougsQuoteUrl(
  companyId: string,
  quoteId: string,
  opts: { status?: "draft" | "pending" | "accepted" | "refused" | null } = {},
): string {
  const status = opts.status ?? "pending";
  return `${BASE}/app/c/${companyId}/invoicing/quote?status=${status}&quoteId=${quoteId}`;
}

/**
 * Helpers de lecture tolérants aux deux schémas Dougs :
 * - "détail" Angular (édition) : totalNetAmount / totalAmountWithVat /
 *   totalVatAmount / clientData.legalName / status
 * - "liste compacte" : netAmount / amount / vatAmount / clientData.name
 *   (ou clientName en racine) / paymentStatus
 *
 * Le détail endpoint /sales-invoices/{id} renvoie parfois le format
 * compact aussi (vérifié 2026-05). Donc on doit toujours lire les deux.
 */
type DougsOperationAttachment = {
  operation?: {
    date?: string | null;
    validatedAt?: string | null;
    deleted?: boolean | null;
    excluded?: boolean | null;
  } | null;
};

type DougsPayloadAny = {
  totalNetAmount?: number | null;
  totalAmountWithVat?: number | null;
  totalVatAmount?: number | null;
  netAmount?: unknown;
  amount?: unknown;
  vatAmount?: unknown;
  paidAt?: string | null;
  issuedAt?: string | null;
  date?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  operationAttachments?: DougsOperationAttachment[] | null;
  /** Pré-match bancaire non validé — cf. pickDougsPaymentHint. */
  operationCandidate?: unknown;
  clientName?: string | null;
  clientData?: {
    legalName?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export function pickDougsHt(o: DougsPayloadAny): number | null {
  if (typeof o.totalNetAmount === "number") return o.totalNetAmount;
  if (typeof o.netAmount === "number") return o.netAmount;
  return null;
}

export function pickDougsTtc(o: DougsPayloadAny): number | null {
  if (typeof o.totalAmountWithVat === "number") return o.totalAmountWithVat;
  if (typeof o.amount === "number") return o.amount;
  return null;
}

export function pickDougsVat(o: DougsPayloadAny): number | null {
  if (typeof o.totalVatAmount === "number") return o.totalVatAmount;
  if (typeof o.vatAmount === "number") return o.vatAmount;
  return null;
}

export function pickDougsPaidAt(o: DougsPayloadAny): string | null {
  // Sur les factures réconciliées via rapprochement bancaire, Dougs laisse
  // `paidAt: null` mais expose la vraie date dans operationAttachments[].
  // On prend la date de virement la plus ancienne (cas paiement en
  // plusieurs fois → première rentrée d'argent), en ignorant les
  // opérations supprimées/exclues.
  if (o.paidAt) return o.paidAt;
  const ops = Array.isArray(o.operationAttachments) ? o.operationAttachments : [];
  const dates = ops
    .map((a) => a?.operation)
    .filter((op): op is NonNullable<typeof op> => !!op && !op.deleted && !op.excluded)
    .map((op) => op.date ?? op.validatedAt ?? null)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return dates[0] ?? null;
}

export function pickDougsIssuedAt(o: DougsPayloadAny): string | null {
  return o.issuedAt ?? o.date ?? null;
}

export function pickDougsStatus(o: DougsPayloadAny): string | null {
  return o.status ?? o.paymentStatus ?? null;
}

export function pickDougsClientName(o: DougsPayloadAny): string | null {
  const c = o.clientData;
  const fromObj = c?.legalName ?? c?.name ?? `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  return (fromObj || o.clientName || null) as string | null;
}

/** Id de société Dougs de la session courante, `null` si pas connecté. */
export async function getDougsCompanyId(userId: string): Promise<string | null> {
  const session = await loadSession(userId);
  return session?.companyId ?? null;
}

/** URL du brouillon dans l'UI Dougs (pour pop-up "voir sur Dougs"). */
export async function getDougsDraftUrl(userId: string, draftId: string): Promise<string> {
  const session = await loadSession(userId);
  if (!session) throw new DougsAuthError("Pas de session Dougs.");
  return buildDougsInvoiceUrl(session.companyId, draftId, { status: "draft" });
}

/**
 * GET d'une facture client (draft ou finalisée). Retourne le payload
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
  createdAt?: string | null;
  clientData?: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export async function getDougsSalesInvoice(
  userId: string,
  invoiceId: string,
): Promise<DougsSalesInvoice> {
  // Tente d'abord l'endpoint des factures finalisées. Si 404 (drafts
  // ne sont pas accessibles via /sales-invoices/{id}), on retombe sur
  // /sales-invoices-drafts/{id}.
  try {
    const res = await dougsFetch(userId, `/companies/{companyId}/sales-invoices/${invoiceId}`);
    return res.json();
  } catch (err) {
    if (err instanceof DougsApiError && err.status === 404) {
      const res = await dougsFetch(
        userId,
        `/companies/{companyId}/sales-invoices-drafts/${invoiceId}`,
      );
      return res.json();
    }
    throw err;
  }
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
export type DougsSalesInvoiceListItem = {
  id: string;
  reference?: string | null;
  status?: string | null;
  totalNetAmount?: number | null;
  totalAmountWithVat?: number | null;
  /** True si l'entrée est un avoir (facture de remboursement). */
  isRefund?: boolean | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  dueDate?: string | null;
  paymentStatus?: string | null;
  operationAttachments?: DougsOperationAttachment[] | null;
  /** Pré-match bancaire non validé — cf. pickDougsPaymentHint. */
  operationCandidate?: unknown;
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

// ---------- Rapprochement bancaire suggéré par Dougs ----------

/**
 * Opération bancaire telle que Dougs l'expose en pièce jointe d'une
 * facture. `signedAmount` est négatif pour un décaissement, positif
 * pour un encaissement ; `isInbound` dit la même chose en booléen.
 */
export type DougsOperationRef = {
  id: number;
  date: string;
  amount: number;
  wording: string;
  type?: string;
  isInbound?: boolean;
  signedAmount?: number;
  deleted?: boolean;
  excluded?: boolean;
  [key: string]: unknown;
};

/**
 * `operationCandidate` : le pré-match que Dougs calcule tout seul entre
 * une facture et une opération du flux bancaire, **avant** validation
 * par le comptable. Tant qu'il n'est pas validé, `paidAt` reste `null`
 * et `operationAttachments` est vide — donc côté Paradeos la facture
 * a l'air impayée alors que l'argent est déjà sur le compte.
 *
 * C'est exactement le cas où il ne faut PAS relancer le client.
 */
export type DougsOperationCandidate = {
  id: number;
  operation: DougsOperationRef;
};

export type DougsPaymentHint = {
  operationId: number;
  /** Date de l'opération bancaire (ISO). */
  date: string | null;
  /** Montant encaissé, toujours positif. */
  amount: number | null;
  /** Libellé brut du relevé, utile pour lever un doute à l'œil. */
  wording: string | null;
};

/**
 * Extrait le pré-match d'encaissement d'une facture, s'il y en a un.
 *
 * Renvoie `null` si :
 *  - il n'y a pas de candidat ;
 *  - le candidat est un décaissement (`isInbound === false` ou
 *    `signedAmount < 0`) — ça arrive sur les avoirs, et un remboursement
 *    sortant n'est pas un encaissement client ;
 *  - l'opération est supprimée ou exclue du rapprochement.
 *
 * On ne regarde volontairement pas `operationAttachments` ici : quand
 * l'attachement existe, le rapprochement est déjà validé et `paidAt` /
 * `pickDougsPaidAt` font le travail. Le candidat n'a d'intérêt que sur
 * la fenêtre "argent arrivé, écriture pas encore validée".
 */
export function pickDougsPaymentHint(o: DougsPayloadAny): DougsPaymentHint | null {
  const candidate = o.operationCandidate;
  if (!candidate || typeof candidate !== "object") return null;
  const op = (candidate as DougsOperationCandidate).operation;
  if (!op || typeof op !== "object") return null;
  if (op.deleted === true || op.excluded === true) return null;

  const signed = typeof op.signedAmount === "number" ? op.signedAmount : null;
  const inbound = typeof op.isInbound === "boolean" ? op.isInbound : signed !== null && signed > 0;
  if (!inbound) return null;

  const amount =
    signed !== null ? Math.abs(signed) : typeof op.amount === "number" ? Math.abs(op.amount) : null;
  return {
    operationId: op.id,
    date: typeof op.date === "string" ? op.date : null,
    amount,
    wording: typeof op.wording === "string" ? op.wording : null,
  };
}

// ---------- Balance âgée ----------

/**
 * Balance âgée native Dougs (`/invoice-stats/aging-balance`).
 *
 * Le format exact n'est pas documenté et n'a pas pu être vérifié en
 * local (Dougs répond 401 hors Vercel, cf. Cloudflare). On garde donc
 * les deux blocs en `unknown` et on normalise à la lecture avec
 * `parseDougsAgingBuckets`, tolérant aux variantes de nommage.
 */
export type DougsAgingBalance = {
  globalRanges?: unknown;
  customerRanges?: unknown;
  [key: string]: unknown;
};

export async function getDougsAgingBalance(userId: string): Promise<DougsAgingBalance> {
  const res = await dougsFetch(userId, "/companies/{companyId}/invoice-stats/aging-balance");
  return res.json();
}

export type DougsAgingBucket = {
  /** Libellé de la tranche tel que rendu ("0-30 j", "> 90 j", …). */
  label: string;
  amount: number;
};

const AGING_AMOUNT_KEYS = ["amount", "total", "value", "totalAmount", "sum"] as const;
const AGING_LABEL_KEYS = ["label", "name", "range", "key", "title"] as const;

function pickNumber(o: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickString(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Normalise `globalRanges` en tranches exploitables. Accepte les deux
 * formes plausibles :
 *  - tableau d'objets `[{ label, amount }, …]`
 *  - dictionnaire `{ "0-30": 1234, "30-60": … }` (valeur nombre ou objet)
 *
 * Toute forme inattendue renvoie `[]` plutôt que de lever : cette donnée
 * est un confort d'affichage, elle ne doit jamais casser la page.
 */
export function parseDougsAgingBuckets(raw: unknown): DougsAgingBucket[] {
  if (!raw) return [];
  const out: DougsAgingBucket[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const o = entry as Record<string, unknown>;
      const amount = pickNumber(o, AGING_AMOUNT_KEYS);
      if (amount === null) continue;
      out.push({ label: pickString(o, AGING_LABEL_KEYS) ?? "—", amount });
    }
    return out;
  }

  if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out.push({ label: key, amount: value });
        continue;
      }
      if (value && typeof value === "object") {
        const amount = pickNumber(value as Record<string, unknown>, AGING_AMOUNT_KEYS);
        if (amount !== null) {
          out.push({
            label: pickString(value as Record<string, unknown>, AGING_LABEL_KEYS) ?? key,
            amount,
          });
        }
      }
    }
  }
  return out;
}

/** Total dû côté Dougs, toutes tranches confondues. */
export function sumDougsAging(buckets: DougsAgingBucket[]): number {
  return buckets.reduce((s, b) => s + b.amount, 0);
}

// ---------- Factures d'achat (fournisseurs) ----------

/**
 * Facture d'achat Dougs. Champs alignés sur ce que renvoie
 * `GET /companies/{id}/vendor-invoices` (pagination `page`/`limit`,
 * différente des factures de vente qui utilisent `limit`/`offset`).
 */
export type DougsVendorInvoice = {
  id: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  date?: string | null;
  label?: string | null;
  memo?: string | null;
  reference?: string | null;
  supplierName?: string | null;
  supplierCountry?: string | null;
  amount?: number | null;
  amountTva?: number | null;
  currency?: string | null;
  isRefund?: boolean | null;
  isLocked?: boolean | null;
  type?: string | null;
  paymentStatus?: string | null;
  prefillStatus?: string | null;
  /** UUID du justificatif, à passer à `downloadDougsFile`. */
  fileId?: number | string | null;
  fileName?: string | null;
  fileType?: string | null;
  filePath?: string | null;
  operationAttachments?: DougsOperationAttachment[] | null;
  operationCandidate?: DougsOperationCandidate | null;
  matchedOperation?: DougsOperationRef | null;
  [key: string]: unknown;
};

export async function listDougsVendorInvoices(
  userId: string,
  opts: { limit?: number; page?: number } = {},
): Promise<DougsVendorInvoice[]> {
  const limit = opts.limit ?? 100;
  const page = opts.page ?? 1;
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/vendor-invoices?limit=${limit}&page=${page}`,
  );
  return res.json();
}

export async function getDougsVendorInvoice(
  userId: string,
  invoiceId: string,
): Promise<DougsVendorInvoice> {
  const res = await dougsFetch(userId, `/companies/{companyId}/vendor-invoices/${invoiceId}`);
  return res.json();
}

/** URL de la facture d'achat dans l'UI Dougs. */
export function buildDougsVendorInvoiceUrl(companyId: string, invoiceId: string): string {
  return `${BASE}/app/c/${companyId}/invoicing/vendor-invoice?vendorInvoiceId=${invoiceId}`;
}

// ---------- Téléchargement de justificatifs ----------

/** Plafond mémoire pour un justificatif (25 Mio). */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 5;

export type DougsDownloadedFile = {
  buffer: Buffer;
  contentType: string;
  filename: string | null;
};

/**
 * Télécharge un justificatif Dougs.
 *
 * Dougs répond par une 302 vers une URL S3/CDN pré-signée. On suit la
 * redirection **à la main** (`redirect: "manual"`) pour une raison de
 * sécurité : `fetch` en mode `follow` rejouerait nos en-têtes — dont le
 * cookie de session Dougs — vers un hôte tiers. Ici, dès que le prochain
 * saut sort de `app.dougs.fr`, on repart sans aucun en-tête : l'URL
 * signée se suffit à elle-même.
 *
 * On refuse par ailleurs tout saut non-HTTPS ou portant des identifiants
 * dans l'URL, et on borne le corps lu à 25 Mio pour ne pas faire sauter
 * la mémoire de la fonction Vercel sur un PDF anormalement gros.
 */
export async function downloadDougsFile(
  userId: string,
  fileUuid: string,
): Promise<DougsDownloadedFile> {
  const session = await loadSession(userId);
  if (!session) {
    throw new DougsAuthError(
      "Aucune session Dougs connectée. Va dans /settings/integrations pour coller ton cookie.",
    );
  }

  let url = new URL(`${BASE}/files/${encodeURIComponent(fileUuid)}/actions/download`);
  let redirects = 0;

  while (true) {
    const sameOrigin = url.origin === BASE;
    const res = await fetchWithTimeout(url, {
      method: "GET",
      redirect: "manual",
      headers: sameOrigin ? { Cookie: session.cookie } : {},
      timeoutMs: 15000,
      label: `Dougs GET ${url.pathname}`,
    });

    if (res.status >= 300 && res.status < 400) {
      if (redirects >= MAX_DOWNLOAD_REDIRECTS) {
        throw new DougsApiError(
          "Trop de redirections sur le téléchargement Dougs.",
          res.status,
          "",
        );
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new DougsApiError("Redirection Dougs sans en-tête Location.", res.status, "");
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new DougsApiError("Redirection Dougs avec une URL invalide.", res.status, "");
      }
      if (next.protocol !== "https:" || next.username || next.password) {
        throw new DougsApiError(
          "Redirection Dougs refusée : HTTPS sans identifiants exigé.",
          res.status,
          "",
        );
      }
      url = next;
      redirects += 1;
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new DougsAuthError(
        "Cookie Dougs expiré ou invalide. Va dans /settings/integrations le rafraîchir.",
      );
    }
    if (!res.ok) {
      throw new DougsApiError(
        `Dougs ${res.status} ${res.statusText} (téléchargement ${fileUuid})`,
        res.status,
        "",
      );
    }

    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      throw new DougsApiError("Justificatif Dougs trop volumineux (> 25 Mio).", 413, "");
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new DougsApiError("Justificatif Dougs trop volumineux (> 25 Mio).", 413, "");
    }

    await touchUsed(userId);
    return {
      buffer,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      filename: parseContentDispositionFilename(res.headers.get("content-disposition")),
    };
  }
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const raw = match?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
