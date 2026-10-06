import { eq } from "drizzle-orm";
import { dougsSessions } from "../../db/schema/dougs";
import { db } from "../db/server";
import { fetchWithRetry } from "../net/fetch-with-retry";
import { decryptCookie } from "./crypto";

/**
 * Client server-side pour l'API interne Dougs (`app.dougs.fr`).
 * Auth : cookie de session stocké chiffré par user (cf. crypto.ts).
 *
 * L'API n'est pas publique — usage à risque limité (Parade SAS), pas
 * de garantie de stabilité. Si Dougs change un endpoint, on patche ici.
 */

export const BASE = "https://app.dougs.fr";

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

export async function loadSession(userId: string): Promise<Session | null> {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(dougsSessions)
    .where(eq(dougsSessions.userId, userId))
    .limit(1);
  if (!row) return null;
  return { cookie: decryptCookie(row.cookieEncrypted), companyId: row.companyId };
}

export async function touchUsed(userId: string): Promise<void> {
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
export async function dougsFetch(
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
