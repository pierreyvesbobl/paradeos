/**
 * Helpers OAuth 2.0 Google. Pas de SDK — fetch direct contre les
 * endpoints standards, c'est plus léger et plus prévisible que
 * `googleapis`.
 *
 * Endpoints :
 *   - Authorize : https://accounts.google.com/o/oauth2/v2/auth
 *   - Token     : https://oauth2.googleapis.com/token
 *   - Revoke    : https://oauth2.googleapis.com/revoke
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Scopes Google demandés au consentement.
 *
 * - `drive.file` : créer/écrire des fichiers ou dossiers via l'app.
 * - `drive.readonly` : lire le contenu des dossiers liés (sans, picker
 *   + drive.file ne renvoie PAS les fichiers existants — limitation
 *   documentée Google).
 * - `calendar.readonly` : lire les calendriers et events de l'user
 *   (affichage en lecture seule dans /planning).
 *
 * `drive.readonly` et `calendar.readonly` sont des "restricted scopes"
 * — en mode "Testing" de l'écran de consentement OAuth, pas de
 * validation Google requise. Pour passer en "Production", review
 * annuelle nécessaire.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** Alias historique — gardé pour la compat avec d'éventuels callers. */
export const GOOGLE_DRIVE_SCOPES = GOOGLE_OAUTH_SCOPES;

export const REQUIRED_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
];

export const REQUIRED_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

export function hasRequiredDriveScopes(grantedScopes: string[]): boolean {
  return REQUIRED_DRIVE_SCOPES.every((s) => grantedScopes.includes(s));
}

export function hasRequiredCalendarScopes(grantedScopes: string[]): boolean {
  return REQUIRED_CALENDAR_SCOPES.every((s) => grantedScopes.includes(s));
}

function getOAuthEnv() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET manquants dans l'env.");
  }
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL manquant — requis pour le redirect URI.");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/api/google/oauth/callback`,
  };
}

export function buildAuthorizeUrl(params: { state: string; scopes?: string[] }): string {
  const { clientId, redirectUri } = getOAuthEnv();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (params.scopes ?? GOOGLE_DRIVE_SCOPES).join(" "));
  // `offline` + `prompt=consent` garantissent qu'on reçoit un
  // refresh_token à chaque autorisation (sans consent forcé, Google
  // ne renvoie le refresh_token qu'à la première autorisation).
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  return url.toString();
}

type TokenExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenExchangeResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthEnv();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Échange code Google échoué (${res.status}) : ${text}`);
  }
  return (await res.json()) as TokenExchangeResponse;
}

type RefreshResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
};

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResponse> {
  const { clientId, clientSecret } = getOAuthEnv();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh token Google échoué (${res.status}) : ${text}`);
  }
  return (await res.json()) as RefreshResponse;
}

export async function revokeToken(token: string): Promise<void> {
  // Si le token est déjà invalide, c'est OK : le but est juste de
  // s'assurer côté Google que la grant disparaît. On n'échoue pas le
  // disconnect si Google répond 400.
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cache: "no-store",
  }).catch(() => undefined);
}

/**
 * Décode le payload d'un id_token JWT *sans* vérifier la signature.
 * On l'a reçu directement depuis Google via TLS donc l'authenticité
 * est déjà acquise par le canal — pas besoin de re-vérifier la sig.
 */
export function decodeIdTokenPayload(idToken: string): {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
} {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("id_token Google invalide.");
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(json);
}
