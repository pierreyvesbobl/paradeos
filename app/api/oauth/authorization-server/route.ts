/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), servi à
 * `/.well-known/oauth-authorization-server` via les rewrites.
 *
 * `code_challenge_methods_supported` ne liste que S256 : `plain` est
 * refusé à l'authorize, conformément à OAuth 2.1.
 */
import { getAppUrl } from "@/lib/app-url";
import { SCOPES } from "@/lib/oauth/config";
import { corsPreflight, jsonWithCors } from "@/lib/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const appUrl = await getAppUrl();
  return jsonWithCors({
    issuer: appUrl,
    authorization_endpoint: `${appUrl}/oauth/authorize`,
    token_endpoint: `${appUrl}/api/oauth/token`,
    registration_endpoint: `${appUrl}/api/oauth/register`,
    revocation_endpoint: `${appUrl}/api/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    service_documentation: `${appUrl}/settings/integrations`,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
