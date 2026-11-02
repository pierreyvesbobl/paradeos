import { fetchWithTimeout } from "../net/fetch-with-timeout";
import { BASE } from "./http";

/**
 * Ce qu'un cookie Dougs permet sur une société donnée.
 *
 *  - `ok`        : la session lit la société.
 *  - `no_access` : session valide, mais sur un compte qui ne voit pas cette
 *                  société. Dougs répond alors 404 sur toutes ses routes, ce
 *                  qui se lit à tort comme « brouillon supprimé ».
 *  - `invalid`   : cookie expiré ou rejeté.
 *  - `unknown`   : Dougs injoignable ou en erreur ; on ne tranche pas.
 */
export type DougsCompanyAccess = "ok" | "no_access" | "invalid" | "unknown";

export function classifyCompanyProbe(status: number): DougsCompanyAccess {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "invalid";
  if (status === 403 || status === 404) return "no_access";
  return "unknown";
}

/**
 * Vérifie qu'un cookie donne accès à la société avant de le stocker. Sans ce
 * contrôle, une reconnexion sur un autre compte Dougs (celui d'une autre
 * société) écrase silencieusement la session qui marchait, et tout ce qui
 * suit — push, aperçu, finalisation — tombe en 404.
 */
export async function probeDougsCompanyAccess(
  cookie: string,
  companyId: string,
): Promise<DougsCompanyAccess> {
  try {
    const res = await fetchWithTimeout(
      `${BASE}/companies/${encodeURIComponent(companyId)}/salesChannels`,
      {
        method: "GET",
        redirect: "manual",
        headers: { Cookie: cookie },
        timeoutMs: 8000,
        label: "Dougs GET /salesChannels (contrôle d'accès)",
      },
    );
    return classifyCompanyProbe(res.status);
  } catch {
    return "unknown";
  }
}

/** Message à renvoyer quand on refuse un cookie, `null` s'il est acceptable. */
export function companyAccessError(access: DougsCompanyAccess, companyId: string): string | null {
  if (access === "no_access") {
    return `Ce compte Dougs n'a pas accès à la société ${companyId}. Connecte-toi sur app.dougs.fr avec le compte qui voit Parade ; la session enregistrée n'a pas été remplacée.`;
  }
  if (access === "invalid") return "Cookie Dougs refusé par Dougs (session expirée ?).";
  return null;
}
