/**
 * Re-export des handlers MCP partagés entre stdio (mcp-server) et HTTP
 * (cette route). Évite la duplication de logique : tools.ts /
 * resources.ts / prompts.ts vivent côté `mcp-server/` mais ne
 * dépendent que de Drizzle + zod, pas de Next, donc importables ici.
 *
 * Note : les imports utilisent un chemin relatif vers mcp-server/
 * (en dehors du tsconfig path alias `@/`).
 */

export * from "../../../mcp-server/tools";
export { readResource, RESOURCE_TEMPLATES } from "../../../mcp-server/resources";
export { PROMPTS, getPromptMessages } from "../../../mcp-server/prompts";
