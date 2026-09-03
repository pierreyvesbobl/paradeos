/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728), servi à
 * `/.well-known/oauth-protected-resource` (et sa variante suffixée du
 * chemin de la ressource) via les rewrites de `next.config.ts`.
 *
 * C'est le premier document que lit un client MCP après un 401 : il y
 * découvre quel serveur d'autorisation utiliser.
 */
import { getAppUrl } from "@/lib/app-url";
import { MCP_PATH, SCOPES, resourceUri } from "@/lib/oauth/config";
import { corsPreflight, jsonWithCors } from "@/lib/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const appUrl = await getAppUrl();
  return jsonWithCors({
    resource: resourceUri(appUrl),
    authorization_servers: [appUrl],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Paradeos MCP",
    resource_documentation: `${appUrl}/settings/integrations`,
    mcp_endpoint: `${appUrl}${MCP_PATH}`,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
