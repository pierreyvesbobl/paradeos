import "server-only";

import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";

/**
 * Wrappers fins autour de Gmail API v1 — fetch direct, sans SDK
 * (cohérent avec drive-api.ts / calendar-api.ts).
 *
 * Tous les helpers attendent un `accessToken` valide (cf.
 * `lib/google/account.ts:getValidAccessToken`). Le scope minimum requis
 * est `gmail.readonly` (cf. `lib/google/oauth.ts:REQUIRED_GMAIL_SCOPES`).
 *
 * Gmail expose une notion de quota différente : 250 quota units /
 * user / second. `messages.get(format=metadata)` coûte 5 units,
 * `messages.list` 5 units, `history.list` 2 units. On reste très en
 * dessous du plafond avec un cap 50 messages / run + sleep 100ms.
 */

const API_BASE = "https://gmail.googleapis.com/gmail/v1";

async function gmailFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    timeoutMs: 6000,
    label: `Gmail API ${path.split("?")[0]}`,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status} : ${text}`);
  }
  return (await res.json()) as T;
}

// ─── messages.list ──────────────────────────────────────────────────────

export type GmailListMessagesResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

/** Liste les ids de messages matchant la query Gmail (q='newer_than:90d'). */
export async function listMessages(
  accessToken: string,
  opts: { q?: string; pageToken?: string; maxResults?: number } = {},
): Promise<GmailListMessagesResponse> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  params.set("maxResults", String(opts.maxResults ?? 100));
  return gmailFetch<GmailListMessagesResponse>(
    `/users/me/messages?${params.toString()}`,
    accessToken,
  );
}

// ─── messages.get ───────────────────────────────────────────────────────

export type GmailHeader = { name: string; value: string };

export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    size?: number;
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** ms since epoch, en string (parseInt). */
  internalDate?: string;
  payload?: GmailMessagePart;
  sizeEstimate?: number;
};

export type GmailMessageFormat = "metadata" | "full" | "minimal" | "raw";

/**
 * `format=metadata` retourne headers + snippet sans body (pas cher).
 * `format=full` retourne payload complet (body inclus). On utilise
 * metadata par défaut pour rester sous le quota, full uniquement quand
 * le message matche un contact CRM.
 */
export async function getMessage(
  accessToken: string,
  messageId: string,
  format: GmailMessageFormat = "metadata",
): Promise<GmailMessage> {
  const params = new URLSearchParams({ format });
  if (format === "metadata") {
    // Limite les headers retournés en mode metadata — sinon Gmail
    // refuse la requête sur certains messages.
    for (const h of ["From", "To", "Cc", "Subject", "Date", "Message-ID"]) {
      params.append("metadataHeaders", h);
    }
  }
  return gmailFetch<GmailMessage>(
    `/users/me/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
    accessToken,
  );
}

// ─── threads.get ────────────────────────────────────────────────────────

export type GmailThread = {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
};

export async function getThread(
  accessToken: string,
  threadId: string,
  format: GmailMessageFormat = "metadata",
): Promise<GmailThread> {
  const params = new URLSearchParams({ format });
  return gmailFetch<GmailThread>(
    `/users/me/threads/${encodeURIComponent(threadId)}?${params.toString()}`,
    accessToken,
  );
}

// ─── history.list ───────────────────────────────────────────────────────

export type GmailHistoryItem = {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
  labelsAdded?: Array<{
    message: { id: string; threadId: string };
    labelIds: string[];
  }>;
  labelsRemoved?: Array<{
    message: { id: string; threadId: string };
    labelIds: string[];
  }>;
};

export type GmailHistoryListResponse = {
  history?: GmailHistoryItem[];
  nextPageToken?: string;
  historyId?: string;
};

/**
 * Liste les changements depuis `startHistoryId`. Si Gmail renvoie 404,
 * c'est que `startHistoryId` est trop ancien (> 7 jours en pratique) :
 * il faut refaire un bootstrap complet. Le caller gère ce cas.
 */
export async function listHistory(
  accessToken: string,
  startHistoryId: number,
  opts: { pageToken?: string; historyTypes?: string[] } = {},
): Promise<GmailHistoryListResponse> {
  const params = new URLSearchParams({ startHistoryId: String(startHistoryId) });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  for (const t of opts.historyTypes ?? [
    "messageAdded",
    "messageDeleted",
    "labelAdded",
    "labelRemoved",
  ]) {
    params.append("historyTypes", t);
  }
  return gmailFetch<GmailHistoryListResponse>(
    `/users/me/history?${params.toString()}`,
    accessToken,
  );
}

// ─── Helpers de parsing ─────────────────────────────────────────────────

/** Extrait la valeur d'un header (case-insensitive) depuis un payload. */
export function getHeader(payload: GmailMessagePart | undefined, name: string): string | null {
  const headers = payload?.headers;
  if (!headers) return null;
  const lower = name.toLowerCase();
  const match = headers.find((h) => h.name.toLowerCase() === lower);
  return match?.value ?? null;
}

/**
 * Parse un header "From" ou "To" au format `"Name" <email@x.com>` ou
 * `email@x.com`. Renvoie une liste (pour To/Cc qui peuvent contenir
 * plusieurs adresses séparées par des virgules).
 */
export function parseAddressList(
  headerValue: string | null,
): Array<{ email: string; name?: string }> {
  if (!headerValue) return [];
  // Split sur les virgules mais pas celles à l'intérieur de "...".
  const parts = headerValue.match(/("[^"]*"\s*<[^>]+>|[^,]+)/g) ?? [];
  const result: Array<{ email: string; name?: string }> = [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    const angle = trimmed.match(/^"?(.*?)"?\s*<([^>]+)>$/);
    if (angle) {
      const name = angle[1]?.trim() || undefined;
      const email = angle[2]?.trim().toLowerCase();
      if (email) result.push({ email, name });
    } else if (trimmed.includes("@")) {
      result.push({ email: trimmed.toLowerCase() });
    }
  }
  return result;
}

/**
 * Reconstruit le body texte depuis un payload Gmail. Préfère
 * `text/plain` ; à défaut, prend `text/html` brut (à sanitizer côté
 * appelant si on l'affiche).
 */
export function extractBodies(payload: GmailMessagePart | undefined): {
  text: string | null;
  html: string | null;
} {
  if (!payload) return { text: null, html: null };

  let text: string | null = null;
  let html: string | null = null;

  function walk(part: GmailMessagePart) {
    const mime = part.mimeType ?? "";
    if (mime === "text/plain" && part.body?.data && !text) {
      text = Buffer.from(part.body.data, "base64url").toString("utf8");
    } else if (mime === "text/html" && part.body?.data && !html) {
      html = Buffer.from(part.body.data, "base64url").toString("utf8");
    }
    for (const sub of part.parts ?? []) walk(sub);
  }
  walk(payload);

  return { text, html };
}

/** `internalDate` Gmail = ms depuis epoch (string). */
export function internalDateToDate(internalDate: string | undefined): Date | null {
  if (!internalDate) return null;
  const n = Number.parseInt(internalDate, 10);
  if (!Number.isFinite(n)) return null;
  return new Date(n);
}
