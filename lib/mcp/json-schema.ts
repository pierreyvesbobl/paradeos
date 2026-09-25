import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Convertit un schéma Zod en JSON Schema MCP-compatible : top-level
 * `{ type: "object", properties, required }` sans `$ref` ni `$schema`.
 * Les MCP clients (Claude.ai, Cursor, etc.) s'appuient là-dessus pour
 * savoir quels arguments envoyer — un `{ type: "object" }` vide casse
 * l'appel car le client n'inclut alors aucun arg.
 */
export function toMcpInputSchema(schema: ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  // Drop legacy openApi metadata + force shape minimale attendue par MCP.
  // biome-ignore lint/performance/noDelete: on veut vraiment supprimer la clé, pas juste undefined
  delete raw.$schema;
  // biome-ignore lint/performance/noDelete: idem
  delete raw.definitions;
  if (raw.type !== "object") {
    return { type: "object" };
  }
  normalizeExclusiveBounds(raw);
  return raw;
}

/**
 * OpenAPI 3.0 écrit les bornes exclusives `{ minimum: 0, exclusiveMinimum:
 * true }` ; JSON Schema (draft 2020-12), que valide l'API Anthropic, attend
 * un nombre : `{ exclusiveMinimum: 0 }`. Sans cette conversion, tout tool
 * portant un `z.number().positive()` (les `limit` des listes, `quantity`…)
 * est rejeté à l'ingestion et n'apparaît jamais côté Claude.
 */
function normalizeExclusiveBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeExclusiveBounds(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  for (const [flag, bound] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ] as const) {
    if (obj[flag] === true && typeof obj[bound] === "number") {
      obj[flag] = obj[bound];
      delete obj[bound];
    } else if (typeof obj[flag] === "boolean") {
      // `false` ne veut rien dire en draft 2020-12 : la borne reste inclusive.
      delete obj[flag];
    }
  }

  for (const value of Object.values(obj)) normalizeExclusiveBounds(value);
}
