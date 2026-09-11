import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Authentification des routes `/api/cron/*` : `Authorization: Bearer
 * <CRON_SECRET>` (Vercel Cron pose le header quand la variable existe).
 * Fail-closed si le secret n'est pas configuré. Comparaison en temps
 * constant, comme pour les tokens OAuth (`lib/oauth/store.ts`).
 */
export function isCronRequestAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Réponse 401 standard, ou `null` si la requête est autorisée. */
export function cronUnauthorized(request: Request): NextResponse | null {
  return isCronRequestAuthorized(request)
    ? null
    : new NextResponse("Unauthorized", { status: 401 });
}

/**
 * Réponse JSON d'un cron : 200 si tout a réussi, 500 dès qu'au moins un
 * élément a échoué. Un cron qui renvoie 200 avec des erreurs dans le
 * corps apparaît « réussi » dans le dashboard Vercel et n'alerte jamais.
 */
export function cronResponse<T extends { failed?: number; errors?: unknown[] }>(body: T) {
  const failed = body.failed ?? body.errors?.length ?? 0;
  return NextResponse.json({ ok: failed === 0, ...body }, { status: failed === 0 ? 200 : 500 });
}
