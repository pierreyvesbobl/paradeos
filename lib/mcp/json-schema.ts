import { type ZodType, z } from "zod";

/**
 * Convertit un schéma Zod en JSON Schema MCP-compatible : top-level
 * `{ type: "object", properties, required }` sans `$ref` ni `$schema`.
 * Les MCP clients (Claude.ai, Cursor, etc.) s'appuient là-dessus pour
 * savoir quels arguments envoyer — un `{ type: "object" }` vide casse
 * l'appel car le client n'inclut alors aucun arg.
 *
 * `io: "input"` : un champ avec `.default()` est optionnel à l'entrée, et
 * c'est l'entrée que décrit un schéma d'arguments. En mode `output` (le
 * défaut de Zod), il serait listé dans `required` et les clients
 * l'exigeraient.
 */
export function toMcpInputSchema(schema: ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
    reused: "inline",
  }) as Record<string, unknown>;
  delete raw.$schema;
  if (raw.type !== "object") {
    return { type: "object" };
  }
  normalizeExclusiveBounds(raw);
  return raw;
}

/**
 * Garde-fou : l'API Anthropic valide du JSON Schema draft 2020-12, où une
 * borne exclusive est un nombre (`{ exclusiveMinimum: 0 }`), jamais le
 * booléen d'OpenAPI 3.0. Zod 4 émet déjà la bonne forme ; on normalise
 * quand même, parce qu'un tool rejeté à l'ingestion n'apparaît jamais
 * côté Claude et que ce n'est pas le genre de régression qu'on voit venir.
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
