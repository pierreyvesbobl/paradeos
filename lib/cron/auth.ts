import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";

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

/**
 * Exécute un cron en répondant tout de suite quand l'appelant passe
 * `?detach=1` : le travail continue après la réponse (`after`, dans la
 * limite de `maxDuration` de la route). C'est pour les déclencheurs qui
 * coupent la connexion au bout de 30 s, cron-job.org en tête — la sync
 * Gmail ou une transcription peuvent prendre plusieurs minutes. GitHub
 * Actions et Vercel Cron gardent le mode synchrone et son code d'erreur.
 * L'authentification se fait avant de détacher : un appel sans secret
 * reçoit son 401, jamais un 202.
 */
export async function cronRun(request: Request, work: () => Promise<Response>): Promise<Response> {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  if (url.searchParams.get("detach") !== "1") return work();
  after(async () => {
    try {
      const res = await work();
      if (!res.ok) console.error(`[cron ${url.pathname}] ${res.status} ${await res.text()}`);
    } catch (err) {
      console.error(`[cron ${url.pathname}]`, err);
    }
  });
  return NextResponse.json({ ok: true, detached: true }, { status: 202 });
}
