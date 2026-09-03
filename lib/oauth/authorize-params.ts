import { DEFAULT_SCOPE, normalizeScope } from "./config";

/**
 * Validation des paramètres de `/oauth/authorize`, partagée entre la page
 * de consentement et la server action qui émet le code — les deux doivent
 * appliquer exactement les mêmes règles.
 */
export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string | null;
};

export type AuthorizeParseResult =
  | { ok: true; params: AuthorizeParams }
  | { ok: false; error: string; description: string };

export function parseAuthorizeParams(sp: URLSearchParams): AuthorizeParseResult {
  const clientId = sp.get("client_id");
  const redirectUri = sp.get("redirect_uri");
  const responseType = sp.get("response_type");
  const codeChallenge = sp.get("code_challenge");
  const method = sp.get("code_challenge_method");

  if (!clientId) return { ok: false, error: "invalid_request", description: "`client_id` requis." };
  if (!redirectUri) {
    return { ok: false, error: "invalid_request", description: "`redirect_uri` requis." };
  }
  if (responseType !== "code") {
    return {
      ok: false,
      error: "unsupported_response_type",
      description: "Seul `response_type=code` est supporté.",
    };
  }
  if (!codeChallenge) {
    return {
      ok: false,
      error: "invalid_request",
      description: "PKCE obligatoire : `code_challenge` manquant.",
    };
  }
  // OAuth 2.1 retire `plain` : accepter S256 uniquement ferme l'interception
  // de code, qui est précisément ce que PKCE doit empêcher.
  if (method !== "S256") {
    return {
      ok: false,
      error: "invalid_request",
      description: "`code_challenge_method=S256` obligatoire.",
    };
  }

  return {
    ok: true,
    params: {
      clientId,
      redirectUri,
      state: sp.get("state"),
      codeChallenge,
      scope: normalizeScope(sp.get("scope") ?? DEFAULT_SCOPE),
      resource: sp.get("resource"),
    },
  };
}
