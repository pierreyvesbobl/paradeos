import { headers } from "next/headers";

/**
 * URL absolue à utiliser dans les liens sortants (magic links, emails…).
 *
 * Ordre de résolution :
 *  1. Headers de la requête courante (`x-forwarded-host` + proto). Couvre
 *     prod, preview deployments et dev local sans configuration.
 *  2. `NEXT_PUBLIC_APP_URL` (si non vide).
 *  3. `VERCEL_PROJECT_PRODUCTION_URL` puis `VERCEL_URL` (auto-injectés sur
 *     Vercel — utile pour les crons/scripts hors contexte requête).
 *  4. `http://localhost:3000` en dernier recours.
 */
export async function getAppUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Pas de contexte requête (cron, script CLI, build) — on retombe sur l'env.
  }

  return getAppUrlFromEnv();
}

/** Variante synchrone, utilisable hors contexte requête (cron, scripts). */
export function getAppUrlFromEnv(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && explicit.length > 0) return explicit;

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${vercelProd}`;

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
}
