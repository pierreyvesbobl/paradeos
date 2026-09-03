/**
 * Constantes du serveur d'autorisation OAuth 2.1 de Paradeos.
 *
 * Paradeos joue les deux rôles de la spec MCP : *authorization server*
 * (issuer = l'app elle-même, adossée à la session Supabase) et *resource
 * server* (l'endpoint `/api/mcp`). Les deux tournent sur la même origine,
 * ce qui évite tout aller-retour cross-domain.
 */

/** Chemin du resource server MCP. */
export const MCP_PATH = "/api/mcp";

/** Scopes exposés. Un connecteur en lecture seule ne demande que `mcp:read`. */
export const SCOPES = ["mcp:read", "mcp:write"] as const;
export type Scope = (typeof SCOPES)[number];

export const DEFAULT_SCOPE = SCOPES.join(" ");

export const SCOPE_LABELS: Record<Scope, string> = {
  "mcp:read": "Lire tes projets, tâches, contacts, notes, meetings et emails rattachés",
  "mcp:write":
    "Créer et modifier des tâches, projets, notes, temps passé — et pousser des devis / factures sur Dougs",
};

/** Access token court (1 h) : limite la fenêtre d'exploitation d'une fuite. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** Refresh token 30 j, rotatif à chaque usage. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Code d'autorisation : usage unique et très court, cf. OAuth 2.1 §7.5. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;

export const TOKEN_PREFIXES = {
  access: "paradeos_oat_",
  refresh: "paradeos_ort_",
} as const;

/** URI canonique du resource server (RFC 8707), sans slash final. */
export function resourceUri(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}${MCP_PATH}`;
}

/**
 * Compare la ressource demandée par le client à notre URI canonique.
 * La spec autorise le client à viser l'origine seule (`https://host`)
 * plutôt que le chemin complet — on accepte les deux, et rien d'autre.
 */
export function isAcceptableResource(requested: string, appUrl: string): boolean {
  const origin = appUrl.replace(/\/$/, "");
  const normalized = requested.replace(/\/$/, "").toLowerCase();
  return normalized === resourceUri(origin).toLowerCase() || normalized === origin.toLowerCase();
}

/** Normalise une liste de scopes : filtre l'inconnu, dédoublonne, ordonne. */
export function normalizeScope(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_SCOPE;
  const asked = new Set(raw.split(/\s+/).filter(Boolean));
  const kept = SCOPES.filter((s) => asked.has(s));
  return kept.length > 0 ? kept.join(" ") : DEFAULT_SCOPE;
}

export function scopeGrants(scope: string, needed: Scope): boolean {
  return scope.split(/\s+/).includes(needed);
}
