import "server-only";

import { getAppUrl } from "@/lib/app-url";
import { resolveToken } from "@/lib/db/queries/api-tokens";
import { DEFAULT_SCOPE, type Scope, isAcceptableResource, scopeGrants } from "./config";
import { resolveAccessToken } from "./store";

export type McpAuth = {
  userId: string;
  /** `pat` = token personnel historique, `oauth` = access token OAuth 2.1. */
  source: "token";
  kind: "pat" | "oauth";
  scope: string;
};

export type McpAuthFailure = {
  status: 401 | 403;
  error: "invalid_token" | "insufficient_scope" | "invalid_request";
  description: string;
};

/**
 * En-tête `WWW-Authenticate` de RFC 9728 §5.1. C'est lui qui rend
 * l'installation « colle juste l'URL » possible : un client sans token
 * reçoit un 401 qui lui indique où lire les métadonnées, et enchaîne
 * tout seul sur la découverte puis le flow OAuth.
 */
export function wwwAuthenticate(appUrl: string, failure?: McpAuthFailure): string {
  const parts = [
    'Bearer realm="Paradeos MCP"',
    `resource_metadata="${appUrl}/.well-known/oauth-protected-resource"`,
  ];
  if (failure) {
    parts.push(`error="${failure.error}"`);
    parts.push(`error_description="${failure.description.replace(/"/g, "'")}"`);
  }
  return parts.join(", ");
}

/**
 * Authentifie une requête MCP. Deux credentials acceptés :
 *
 *  - `paradeos_pat_…` — les tokens personnels historiques, conservés pour
 *    ne pas casser les installations existantes. Ils portent tous les
 *    scopes.
 *  - `paradeos_oat_…` — access token OAuth, dont on valide l'audience
 *    (RFC 8707) : un token émis pour une autre ressource est refusé,
 *    c'est l'exigence centrale de la spec MCP côté resource server.
 */
export async function resolveMcpAuth(
  authorization: string | null,
): Promise<{ ok: true; auth: McpAuth } | { ok: false; failure: McpAuthFailure }> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) {
    return {
      ok: false,
      failure: {
        status: 401,
        error: "invalid_request",
        description: "Token manquant.",
      },
    };
  }
  const token = match[1];

  if (token.startsWith("paradeos_pat_")) {
    const resolved = await resolveToken(token);
    if (!resolved) {
      return {
        ok: false,
        failure: { status: 401, error: "invalid_token", description: "Token invalide ou révoqué." },
      };
    }
    return {
      ok: true,
      auth: { userId: resolved.userId, source: "token", kind: "pat", scope: DEFAULT_SCOPE },
    };
  }

  if (token.startsWith("paradeos_oat_")) {
    const resolved = await resolveAccessToken(token);
    if (!resolved) {
      return {
        ok: false,
        failure: { status: 401, error: "invalid_token", description: "Token expiré ou révoqué." },
      };
    }
    const appUrl = await getAppUrl();
    if (!isAcceptableResource(resolved.resource, appUrl)) {
      return {
        ok: false,
        failure: {
          status: 401,
          error: "invalid_token",
          description: "Token émis pour une autre ressource.",
        },
      };
    }
    return {
      ok: true,
      auth: { userId: resolved.userId, source: "token", kind: "oauth", scope: resolved.scope },
    };
  }

  return {
    ok: false,
    failure: { status: 401, error: "invalid_token", description: "Format de token inconnu." },
  };
}

export function requireScope(auth: McpAuth, needed: Scope): McpAuthFailure | null {
  if (scopeGrants(auth.scope, needed)) return null;
  return {
    status: 403,
    error: "insufficient_scope",
    description: `Scope \`${needed}\` requis pour ce tool.`,
  };
}
