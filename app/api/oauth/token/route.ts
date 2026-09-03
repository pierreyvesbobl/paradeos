/**
 * Token endpoint OAuth 2.1 : échange d'un code d'autorisation (avec
 * vérification PKCE) et rotation des refresh tokens.
 *
 * Le corps est en `application/x-www-form-urlencoded`, conformément à
 * la spec — pas de JSON ici, plusieurs clients MCP n'envoient que ça.
 */
import { getAppUrl } from "@/lib/app-url";
import { isAcceptableResource } from "@/lib/oauth/config";
import { corsPreflight, jsonWithCors, oauthError } from "@/lib/oauth/http";
import { verifyPkce } from "@/lib/oauth/pkce";
import {
  clientSecretMatches,
  consumeAuthorizationCode,
  findToken,
  getClient,
  issueTokens,
  rotateRefreshToken,
} from "@/lib/oauth/store";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Le client peut s'authentifier par `client_secret_basic` (en-tête) ou
 * `client_secret_post` (corps) ; un client public n'envoie rien.
 */
function readClientCredentials(req: NextRequest, form: URLSearchParams) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, sep)),
          clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
        };
      }
    } catch {
      // En-tête Basic illisible — on retombe sur les champs du corps.
    }
  }
  return {
    clientId: form.get("client_id"),
    clientSecret: form.get("client_secret"),
  };
}

export async function POST(req: NextRequest) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return oauthError("invalid_request", "Corps de requête illisible.");
  }

  const grantType = form.get("grant_type");
  const { clientId, clientSecret } = readClientCredentials(req, form);
  if (!clientId) return oauthError("invalid_client", "`client_id` requis.", 401);

  const client = await getClient(clientId);
  if (!client) return oauthError("invalid_client", "Client inconnu.", 401);
  if (!clientSecretMatches(client, clientSecret)) {
    return oauthError("invalid_client", "Secret client invalide.", 401);
  }

  const appUrl = await getAppUrl();

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !verifier) {
      return oauthError("invalid_request", "`code` et `code_verifier` requis.");
    }

    const row = await consumeAuthorizationCode(code);
    if (!row) return oauthError("invalid_grant", "Code inconnu, expiré ou déjà utilisé.");
    if (row.clientId !== clientId) {
      return oauthError("invalid_grant", "Ce code appartient à un autre client.");
    }
    // La spec impose un redirect_uri identique à celui de l'authorize.
    if (redirectUri && redirectUri !== row.redirectUri) {
      return oauthError("invalid_grant", "`redirect_uri` ne correspond pas à celui du code.");
    }
    if (!verifyPkce(verifier, row.codeChallenge)) {
      return oauthError("invalid_grant", "Vérification PKCE échouée.");
    }

    // RFC 8707 : si le client redemande une ressource, elle doit rester
    // celle du code — sinon on émettrait un token pour une autre audience.
    const requestedResource = form.get("resource");
    if (requestedResource && !isAcceptableResource(requestedResource, appUrl)) {
      return oauthError("invalid_target", "Ressource demandée inconnue de ce serveur.");
    }

    const issued = await issueTokens({
      clientId,
      userId: row.userId,
      scope: row.scope,
      resource: row.resource,
    });
    return jsonWithCors(
      {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: row.scope,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (grantType === "refresh_token") {
    const provided = form.get("refresh_token");
    if (!provided) return oauthError("invalid_request", "`refresh_token` requis.");

    const row = await findToken("refresh", provided);
    if (!row || row.clientId !== clientId) {
      return oauthError("invalid_grant", "Refresh token inconnu.");
    }

    const issued = await rotateRefreshToken(row);
    if (!issued) {
      // Rejeu détecté ou token périmé : `rotateRefreshToken` a déjà
      // révoqué la session côté store.
      return oauthError("invalid_grant", "Refresh token expiré ou déjà utilisé.");
    }

    return jsonWithCors(
      {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: row.scope,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return oauthError(
    "unsupported_grant_type",
    `grant_type non supporté : ${grantType ?? "absent"}.`,
  );
}

export function OPTIONS() {
  return corsPreflight();
}
