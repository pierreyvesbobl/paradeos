/**
 * Re-export des handlers MCP rangés dans `mcp-server/` (tools par
 * domaine, resources, prompts), servis par cette route.
 *
 * Note : les imports utilisent un chemin relatif vers mcp-server/
 * (en dehors du tsconfig path alias `@/`).
 */

export { getPromptMessages, PROMPTS } from "../../../mcp-server/prompts";
export { RESOURCE_TEMPLATES, readResource } from "../../../mcp-server/resources";
export * from "../../../mcp-server/tools";
