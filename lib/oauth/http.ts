import { NextResponse } from "next/server";

/**
 * En-têtes CORS communs aux endpoints OAuth et MCP. Les clients MCP
 * « web » (claude.ai) appellent depuis un navigateur : sans ces en-têtes
 * la découverte échoue silencieusement côté client. `WWW-Authenticate`
 * doit être *exposé*, sinon le JS client ne peut pas lire l'URL des
 * métadonnées qu'on y met.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonWithCors(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return NextResponse.json(body, { status: init?.status ?? 200, headers });
}

/** Erreur au format OAuth 2.1 (§3.2.3 / RFC 6749 §5.2). */
export function oauthError(
  error: string,
  description: string,
  status = 400,
  extraHeaders?: Record<string, string>,
) {
  return jsonWithCors({ error, error_description: description }, { status, headers: extraHeaders });
}
