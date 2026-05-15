import "server-only";

import { dougsSessions } from "@/db/schema/dougs";
import { db } from "@/lib/db/server";
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
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "User-Agent": BROWSER_UA,
  Origin: BASE,
  Referer: `${BASE}/app/`,
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
};

/**
 * Si `DOUGS_PROXY_URL` est défini, on route via un Apps Script déployé
 * côté Google. Pourquoi : Cloudflare devant app.dougs.fr bloque les
 * fetch depuis Vercel/Node.js (fingerprint TLS), même avec un cookie
 * valide et tous les headers Chrome simulés. Les IPs Google
 * (UrlFetchApp) passent le filtre Cloudflare proprement.
 *
 * Côté Apps Script, l'action attendue est :
 *   POST { action: 'dougsProxy', method, path, body, cookie, secret }
 * → renvoie { success, status, body }
 *
 * Cf. chrome-extension/README ou docs/dougs-proxy-apps-script.md pour
 * le code à coller dans le projet Apps Script existant.
 */
async function proxyFetch(
  proxyUrl: string,
  cookie: string,
  path: string,
  method: string,
  body: BodyInit | null | undefined,
): Promise<{ status: number; text: string }> {
  const secret = process.env.DOUGS_PROXY_SECRET;
  const payload = {
    action: "dougsProxy",
    method,
    path,
    body: body === undefined || body === null ? null : String(body),
    cookie,
    secret,
  };
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new DougsApiError(
      `Proxy Apps Script ${res.status} ${res.statusText}`,
      res.status,
      (await res.text()).slice(0, 500),
    );
  }
  const json = (await res.json()) as {
    success?: boolean;
    error?: string;
    status?: number;
    body?: string;
  };
  if (!json.success) {
    throw new DougsApiError(
      `Proxy Apps Script : ${json.error ?? "erreur inconnue"}`,
      json.status ?? 500,
      json.body ?? "",
    );
  }
  return { status: json.status ?? 0, text: json.body ?? "" };
}

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
  const method = init?.method ?? "GET";

  let status: number;
  let bodyText: string;
  let directResponse: Response | null = null;

  const proxyUrl = process.env.DOUGS_PROXY_URL;
  if (proxyUrl) {
    const proxied = await proxyFetch(proxyUrl, session.cookie, path, method, init?.body);
    status = proxied.status;
    bodyText = proxied.text;
  } else {
    directResponse = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...BROWSER_HEADERS,
        ...(init?.headers ?? {}),
        Cookie: session.cookie,
      },
    });
    status = directResponse.status;
    bodyText = "";
  }

  if (status === 401 || status === 403) {
    const body = directResponse ? await directResponse.text().catch(() => "") : bodyText;
    console.error(`[dougs auth] ${method} ${path} → ${status}`, body.slice(0, 500));
    throw new DougsAuthError(
      `Dougs ${status}${body ? ` (${body.slice(0, 200)})` : ""} — ${
        proxyUrl
          ? "le cookie est invalide ou Dougs a refusé. Rafraîchis dans /settings/integrations."
          : "sans DOUGS_PROXY_URL, Cloudflare bloque le fingerprint TLS de Node/Vercel. Configure le proxy Apps Script."
      }`,
    );
  }
  if (status < 200 || status >= 300) {
    const body = directResponse ? await directResponse.text() : bodyText;
    console.error(`[dougs] ${method} ${path} → ${status}`, body.slice(0, 500));
    throw new DougsApiError(`Dougs ${status} (${method} ${path})`, status, body.slice(0, 500));
  }
  await touchUsed(userId);

  // Reconstruct a Response from the proxied body so callers can use .json() / .text() uniformly.
  if (directResponse) return directResponse;
  return new Response(bodyText, {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
