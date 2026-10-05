import { eq } from "drizzle-orm";
import { dougsSessions } from "../../db/schema/dougs";
import { db } from "../db/server";
import { fetchWithRetry } from "../net/fetch-with-retry";
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
  init?: RequestInit & {
    /**
     * Laisse `FormData` poser lui-même son `Content-Type` avec sa
     * boundary. Sans ça, l'en-tête JSON forcé ci-dessous écrase la
     * boundary et Dougs répond 400 sur l'upload de justificatif.
     */
    multipart?: boolean;
    /** Surcharge du timeout : un upload de PDF ne tient pas en 8 s. */
    timeoutMs?: number;
  },
): Promise<Response> {
  const session = await loadSession(userId);
  if (!session) {
    throw new DougsAuthError(
      "Aucune session Dougs connectée. Va dans /settings/integrations pour coller ton cookie.",
    );
  }
  const { multipart, timeoutMs, ...rest } = init ?? {};
  const path = pathTemplate.replace("{companyId}", session.companyId);
  const res = await fetchWithRetry(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      ...(rest.headers ?? {}),
      Cookie: session.cookie,
    },
    // Dougs derrière Cloudflare → si Cloudflare met du temps à répondre,
    // sans borne la page reste ouverte jusqu'à la limite Vercel. 8 s :
    // un peu plus que Drive parce que Dougs est régulièrement lent sur
    // les list endpoints, mais assez court pour ne pas bloquer l'UI.
    timeoutMs: timeoutMs ?? 8000,
    label: `Dougs ${rest.method ?? "GET"} ${pathTemplate}`,
  });
  if (res.status === 401 || res.status === 403) {
    throw new DougsAuthError(
      "Cookie Dougs expiré ou invalide. Va dans /settings/integrations le rafraîchir.",
    );
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`[dougs] ${rest.method ?? "GET"} ${path} → ${res.status}`, body.slice(0, 500));
    throw new DougsApiError(
      `Dougs ${res.status} ${res.statusText} (${rest.method ?? "GET"} ${path})`,
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

/** Un motif de refus de finalisation renvoyé par Dougs. */
export type DougsFinalizeBlocker = { field: string; message: string };

/**
 * Parseur tolérant de la réponse `can-finalize`. Dougs documente un tableau
 * d'objets `{field, message}`, mais comme pour les autres endpoints de ce
 * fichier la forme n'a pas pu être vérifiée en live (401 hors Vercel) : on
 * accepte aussi un `null`, un objet qui emballe le tableau, et des entrées
 * qui ne seraient que des chaînes.
 *
 * Le défaut est volontairement « pas de bloqueur » uniquement pour une
 * réponse vide ou nulle. Une forme inattendue remonte un bloqueur
 * synthétique : mieux vaut refuser de finaliser que finaliser à l'aveugle
 * parce qu'on n'a pas su lire la réponse.
 */
export function parseDougsFinalizeBlockers(raw: unknown): DougsFinalizeBlocker[] {
  if (raw == null || raw === "") return [];
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "object"
      ? ((raw as Record<string, unknown>).errors ??
        (raw as Record<string, unknown>).blockers ??
        (raw as Record<string, unknown>).data)
      : undefined;
  if (arr === undefined) {
    return [{ field: "_unknown", message: `Réponse can-finalize illisible : ${typeof raw}` }];
  }
  if (arr == null) return [];
  if (!Array.isArray(arr)) {
    return [{ field: "_unknown", message: "Réponse can-finalize illisible (pas un tableau)." }];
  }
  return arr.map((item) => {
    if (typeof item === "string") return { field: "_", message: item };
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      field: typeof o.field === "string" ? o.field : "_",
      message:
        typeof o.message === "string"
          ? o.message
          : typeof o.error === "string"
            ? o.error
            : "Blocage non détaillé par Dougs.",
    };
  });
}

/**
 * Vérifie qu'un brouillon de facture de vente est finalisable. Tableau vide
 * = prêt. Les blocages typiques portent sur le client (`legalName`, `address`)
 * ou sur des lignes sans titre ni prix.
 *
 * On ne corrige jamais un blocage en patchant les données émetteur à la
 * place de l'utilisateur : ça concerne souvent les réglages de facturation
 * Parade, qu'il vaut mieux faire corriger à la main.
 */
export async function canFinalizeDougsSalesInvoice(
  userId: string,
  draftId: string,
): Promise<DougsFinalizeBlocker[]> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices-drafts/${draftId}/actions/can-finalize`,
  );
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return parseDougsFinalizeBlockers(JSON.parse(text));
  } catch {
    return [{ field: "_unknown", message: "Réponse can-finalize non JSON." }];
  }
}

/**
 * Finalise un brouillon : génère le numéro de facture définitif et ouvre le
 * cycle de vie comptable. **Irréversible** — une facture finalisée ne peut
 * plus qu'être annulée par un avoir.
 *
 * Noter le verbe : c'est un POST pour les factures de vente, là où les devis
 * utilisent un PUT. Ne pas recopier le pattern des devis.
 */
export async function finalizeDougsSalesInvoice(
  userId: string,
  draftId: string,
): Promise<DougsSalesInvoiceDraft> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices-drafts/${draftId}/actions/finalize`,
    {
      method: "POST",
      body: "{}",
      // Dougs génère le PDF définitif pendant cet appel : les 8 s par défaut
      // sont trop justes.
      timeoutMs: 20000,
    },
  );
  return res.json();
}

/**
 * Envoie une facture par mail au client, depuis Dougs (le PDF joint est donc le
 * document légal, avec son numéro définitif).
 *
 * S'applique à `/sales-invoices/{id}`, la ressource **finalisée**. Attention :
 * après finalisation Dougs attribue à la facture un **id différent de celui du
 * brouillon** — passer l'id du brouillon ici renvoie 400.
 *
 * La forme du payload a été relevée sur l'UI Dougs (2026-10-05), parce que la
 * doc interne ne la donnait pas et que les noms ne sont pas ceux qu'on devine :
 * `recipient` est une **chaîne** (pas un tableau `to`), le corps s'appelle
 * `message` (pas `body`), et `copyReceivers` / `selfCopy` sont attendus même
 * vides. Un champ inconnu ou manquant fait répondre
 * `{"message":"Bad Request","statusCode":400}`, sans dire lequel.
 */
export async function sendDougsSalesInvoiceEmail(
  userId: string,
  invoiceId: string,
  mail: {
    /** Destinataire principal. Un seul, c'est ce qu'attend Dougs. */
    to: string;
    subject: string;
    body: string;
    /** Destinataires en copie. */
    cc?: string[];
    /** Copie à l'émetteur. */
    selfCopy?: boolean;
  },
): Promise<void> {
  await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices/${invoiceId}/actions/send-email`,
    {
      method: "POST",
      body: JSON.stringify({
        recipient: mail.to,
        copyReceivers: mail.cc ?? [],
        selfCopy: mail.selfCopy ?? false,
        subject: mail.subject,
        message: mail.body,
      }),
      timeoutMs: 20000,
    },
  );
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
  reference?: unknown;
  numberPrefix?: unknown;
  number?: unknown;
  filePath?: unknown;
  pdfFileId?: unknown;
  file?: unknown;
  fileId?: unknown;
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

/**
 * Référence lisible d'une facture ou d'un devis. Dougs la renvoie tantôt dans
 * `reference`, tantôt seulement en pièces détachées (`numberPrefix` + `number`)
 * — observé sur une facture fraîchement finalisée, dont le `reference` était
 * absent alors que le numéro était bien attribué.
 */
export function pickDougsReference(o: DougsPayloadAny): string | null {
  const direct = (o as { reference?: unknown }).reference;
  if (typeof direct === "string" && direct.trim()) return direct;
  const prefix = (o as { numberPrefix?: unknown }).numberPrefix;
  const number = (o as { number?: unknown }).number;
  if (
    typeof prefix === "string" &&
    prefix &&
    (typeof number === "number" || typeof number === "string")
  ) {
    return `${prefix}${number}`;
  }
  if (typeof number === "number" || (typeof number === "string" && number)) return String(number);
  return null;
}

/**
 * UUID du PDF d'une facture ou d'un devis, à passer à `downloadDougsFile`.
 *
 * Attention : le champ `fileId` est un identifiant **numérique** inutilisable
 * tel quel ; l'UUID vit dans `filePath`, de la forme
 * `/files/{uuid}/actions/download`. On accepte aussi `pdfFileId` quand il a
 * déjà la forme d'un UUID.
 */
export function pickDougsFileUuid(o: DougsPayloadAny): string | null {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const key of ["filePath", "pdfFileId", "file", "fileId"] as const) {
    const raw = (o as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    const found = raw.match(UUID);
    if (found) return found[0];
  }
  return null;
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

// ---------- Opérations bancaires & justificatifs ----------

/**
 * Pièce justificative attachée à une opération. Le champ qui compte est
 * `id` : c'est lui qui permet de détacher une pièce posée par erreur.
 */
export type DougsSourceDocumentAttachment = {
  id: number | string;
  fileName?: string | null;
  fileId?: number | string | null;
  [key: string]: unknown;
};

/**
 * Opération du relevé, telle que `/operations` la renvoie. Superset de
 * `DougsOperationRef` : la liste porte en plus l'état de validation et
 * les pièces déjà attachées, qui sont exactement ce qu'on vient chercher.
 */
export type DougsOperation = DougsOperationRef & {
  validated?: boolean | null;
  sourceDocumentAttachments?: DougsSourceDocumentAttachment[] | null;
};

/**
 * Liste les opérations bancaires.
 *
 * `validated=false&needsAttention=false` donne les opérations « à valider »
 * standard — celles dont on cherche les justificatifs manquants.
 */
export async function listDougsOperations(
  userId: string,
  opts: {
    limit?: number;
    offset?: number;
    validated?: boolean;
    needsAttention?: boolean;
  } = {},
): Promise<DougsOperation[]> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
  });
  if (opts.validated !== undefined) params.set("validated", String(opts.validated));
  if (opts.needsAttention !== undefined) {
    params.set("needsAttention", String(opts.needsAttention));
  }
  const res = await dougsFetch(userId, `/companies/{companyId}/operations?${params}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Détail d'une opération — c'est ici qu'on relit `sourceDocumentAttachments`. */
export async function getDougsOperation(
  userId: string,
  operationId: number | string,
): Promise<DougsOperation> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/operations/${encodeURIComponent(String(operationId))}`,
  );
  return res.json();
}

/**
 * Attache un justificatif à une opération.
 *
 * Deux détails non négociables de l'API, découverts à la main : le
 * suffixe `/actions/create-from-formdata` (sans lui, 400) et le champ
 * FormData nommé exactement `file`.
 *
 * Cette fonction ne valide JAMAIS l'opération : après l'upload, elle
 * reste « à valider » côté Dougs, et c'est à un humain de trancher. Toute
 * évolution de ce module doit préserver ça.
 */
export async function uploadDougsOperationAttachment(
  userId: string,
  operationId: number | string,
  file: { filename: string; bytes: Buffer; contentType?: string },
): Promise<DougsSourceDocumentAttachment | null> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType ?? "application/pdf" }),
    file.filename,
  );

  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/operations/${encodeURIComponent(
      String(operationId),
    )}/source-document-attachments/actions/create-from-formdata`,
    { method: "POST", body: form, multipart: true, timeoutMs: 30_000 },
  );

  // Dougs renvoie tantôt l'attachement créé, tantôt l'opération entière.
  // On récupère l'identifiant dans les deux cas — sans lui, « Détacher »
  // ne serait plus possible.
  try {
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return null;
    const list = (data as { sourceDocumentAttachments?: unknown }).sourceDocumentAttachments;
    if (Array.isArray(list)) {
      return (list[list.length - 1] as DougsSourceDocumentAttachment) ?? null;
    }
    return data as DougsSourceDocumentAttachment;
  } catch {
    return null;
  }
}

/** Retire une pièce attachée par erreur. */
export async function deleteDougsOperationAttachment(
  userId: string,
  operationId: number | string,
  attachmentId: number | string,
): Promise<void> {
  await dougsFetch(
    userId,
    `/companies/{companyId}/operations/${encodeURIComponent(
      String(operationId),
    )}/source-document-attachments/${encodeURIComponent(String(attachmentId))}`,
    { method: "DELETE" },
  );
}

/** URL de la liste des opérations dans l'UI Dougs. */
/**
 * Téléverse une image comme logo de facturation et renvoie son UUID, à poser
 * sur `logoUuid` d'un devis ou d'une facture.
 *
 * Endpoint relevé sur l'UI Dougs (2026-10-05) :
 * `POST /companies/{id}/attachments?filename=…&type=invoicingLogo`, multipart,
 * champ nommé exactement `file`. Le nom de fichier est passé **deux fois** —
 * en query et dans le Content-Disposition — c'est ce que fait l'UI.
 *
 * À la différence d'un téléversement depuis les réglages Dougs, cet appel ne
 * crée que la pièce jointe : il **ne déplace pas** `defaultLogoUuid`. C'est
 * exactement ce qu'on veut, puisque ce défaut est global à la société et
 * repeindrait les factures de toutes les marques.
 *
 * La forme de la réponse n'est pas documentée, d'où l'extraction tolérante de
 * l'UUID.
 */
export async function uploadDougsInvoicingLogo(
  userId: string,
  file: { filename: string; content: Buffer; contentType: string },
): Promise<{ uuid: string; raw: unknown }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.content)], { type: file.contentType }),
    file.filename,
  );

  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/attachments?filename=${encodeURIComponent(file.filename)}&type=invoicingLogo`,
    { method: "POST", body: form, multipart: true, timeoutMs: 30000 },
  );
  const raw = await res.json();
  const uuid = pickUuidDeep(raw);
  if (!uuid) {
    throw new DougsApiError(
      "Logo téléversé mais Dougs n'a pas renvoyé d'identifiant exploitable.",
      res.status,
      JSON.stringify(raw).slice(0, 300),
    );
  }
  return { uuid, raw };
}

/**
 * Cherche un UUID n'importe où dans une réponse Dougs. Volontairement laxiste :
 * selon les endpoints l'identifiant s'appelle `uuid`, `id`, ou n'apparaît que
 * dans un `filePath`, et on ne sait pas lequel s'applique ici.
 */
function pickUuidDeep(value: unknown, depth = 0): string | null {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (depth > 4) return null;
  if (typeof value === "string") return value.match(UUID)?.[0] ?? null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickUuidDeep(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    // On privilégie les clés les plus probables avant de ratisser le reste.
    const o = value as Record<string, unknown>;
    for (const key of ["uuid", "fileUuid", "filePath", "id", "file"]) {
      if (key in o) {
        const found = pickUuidDeep(o[key], depth + 1);
        if (found) return found;
      }
    }
    for (const v of Object.values(o)) {
      const found = pickUuidDeep(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Réglages de facturation de la société : identité légale de l'émetteur,
 * numérotation, logo par défaut. Lecture seule.
 */
export async function getDougsInvoicer(userId: string): Promise<Record<string, unknown>> {
  const res = await dougsFetch(userId, "/companies/{companyId}/invoicer");
  return res.json();
}

export function buildDougsOperationsUrl(companyId: string): string {
  return `${BASE}/app/c/${companyId}/accounting/operations/payments`;
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
  return downloadFromDougs(
    userId,
    `/files/${encodeURIComponent(fileUuid)}/actions/download`,
    fileUuid,
  );
}

/**
 * PDF d'un **brouillon** de facture de vente. Permet de montrer le document
 * exact que recevra le client sans le finaliser, donc sans consommer de numéro
 * de facture.
 */
export async function downloadDougsSalesInvoiceDraftPdf(
  userId: string,
  draftId: string,
): Promise<DougsDownloadedFile> {
  return downloadFromDougs(
    userId,
    `/companies/{companyId}/sales-invoices-drafts/${draftId}/actions/download`,
    `brouillon ${draftId}`,
  );
}

/** PDF d'un brouillon de devis. Même usage que ci-dessus. */
export async function downloadDougsQuoteDraftPdf(
  userId: string,
  draftId: string,
): Promise<DougsDownloadedFile> {
  return downloadFromDougs(
    userId,
    `/companies/{companyId}/invoicing/quote-drafts/${draftId}/actions/download`,
    `devis ${draftId}`,
  );
}

async function downloadFromDougs(
  userId: string,
  pathTemplate: string,
  label: string,
): Promise<DougsDownloadedFile> {
  const session = await loadSession(userId);
  if (!session) {
    throw new DougsAuthError(
      "Aucune session Dougs connectée. Va dans /settings/integrations pour coller ton cookie.",
    );
  }

  let url = new URL(`${BASE}${pathTemplate.replace("{companyId}", session.companyId)}`);
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
        `Dougs ${res.status} ${res.statusText} (téléchargement ${label})`,
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
