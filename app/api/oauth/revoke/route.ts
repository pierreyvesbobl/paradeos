/**
 * Token Revocation (RFC 7009). Permet à un client de rendre ses tokens
 * quand l'utilisateur déconnecte le connecteur de son côté.
 *
 * La spec impose de répondre 200 même pour un token inconnu : révéler
 * qu'un token existe serait un oracle.
 */
import { corsPreflight, jsonWithCors, oauthError } from "@/lib/oauth/http";
import { revokeToken } from "@/lib/oauth/store";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return oauthError("invalid_request", "Corps de requête illisible.");
  }
  const token = form.get("token");
  if (token) await revokeToken(token);
  return jsonWithCors({});
}

export function OPTIONS() {
  return corsPreflight();
}
