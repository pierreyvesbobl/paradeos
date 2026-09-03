import { DEFAULT_SCOPE, normalizeScope } from "@/lib/oauth/config";
import { corsPreflight, jsonWithCors, oauthError } from "@/lib/oauth/http";
/**
 * Dynamic Client Registration (RFC 7591). Endpoint public non
 * authentifié — c'est ce qui permet à un client MCP inconnu (Claude.ai,
 * Cursor…) d'obtenir un `client_id` sans intervention humaine.
 *
 * L'enregistrement seul ne donne accès à rien : il faut ensuite qu'un
 * membre de l'équipe, connecté à Paradeos, approuve explicitement le
 * client sur l'écran de consentement. Les garde-fous ici servent donc
 * surtout à éviter le remplissage de table et les redirections ouvertes.
 */
import { recentClientRegistrations, registerClient } from "@/lib/oauth/store";
import type { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REGISTRATIONS_PER_HOUR = 60;

/**
 * OAuth 2.1 impose des redirect URIs soit HTTPS, soit en loopback.
 * Les clients MCP de bureau écoutent sur `http://localhost:<port>` ou
 * `http://127.0.0.1:<port>` — c'est le seul HTTP toléré.
 */
function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return false;
}

const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().min(1)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .optional(),
  scope: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Corps JSON illisible.");
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return oauthError(
      "invalid_client_metadata",
      "Métadonnées invalides : `redirect_uris` est requis.",
    );
  }
  const meta = parsed.data;

  const badUri = meta.redirect_uris.find((u) => !isAllowedRedirectUri(u));
  if (badUri) {
    return oauthError(
      "invalid_redirect_uri",
      `redirect_uri refusé : ${badUri}. HTTPS requis (ou http://localhost).`,
    );
  }

  if ((await recentClientRegistrations()) >= MAX_REGISTRATIONS_PER_HOUR) {
    return oauthError(
      "temporarily_unavailable",
      "Trop d'enregistrements récents, réessaie dans quelques minutes.",
      429,
    );
  }

  const grantTypes = meta.grant_types?.length
    ? meta.grant_types.filter((g) => g === "authorization_code" || g === "refresh_token")
    : ["authorization_code", "refresh_token"];
  if (grantTypes.length === 0) {
    return oauthError(
      "invalid_client_metadata",
      "Seuls `authorization_code` et `refresh_token` sont supportés.",
    );
  }

  const { clientId, clientSecret, createdAt } = await registerClient({
    clientName: meta.client_name ?? "Client MCP",
    redirectUris: meta.redirect_uris,
    grantTypes,
    tokenEndpointAuthMethod: meta.token_endpoint_auth_method ?? "none",
    scope: normalizeScope(meta.scope ?? DEFAULT_SCOPE),
  });

  return jsonWithCors(
    {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
      ...(clientSecret ? { client_secret_expires_at: 0 } : {}),
      client_name: meta.client_name ?? "Client MCP",
      redirect_uris: meta.redirect_uris,
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: meta.token_endpoint_auth_method ?? "none",
      scope: normalizeScope(meta.scope ?? DEFAULT_SCOPE),
    },
    { status: 201 },
  );
}

export function OPTIONS() {
  return corsPreflight();
}
