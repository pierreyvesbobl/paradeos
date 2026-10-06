import { generateText, type LanguageModel, Output } from "ai";
import type { z } from "zod";

/**
 * Sortie structurée (un objet validé par un schéma Zod) — remplace
 * `generateObject`, déprécié depuis AI SDK 7 au profit de `generateText`
 * avec l'option `output`. Les trois extractions LLM de l'app passent par
 * ici pour n'avoir qu'un seul endroit à adapter au prochain changement
 * d'API.
 */
export async function generateStructured<T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  instructions: string;
  prompt: string;
  temperature?: number;
  abortSignal?: AbortSignal;
}): Promise<T> {
  const { schema, ...rest } = args;
  const result = await generateText({ ...rest, output: Output.object({ schema }) });
  if (result.output === undefined) {
    throw new Error("Le modèle n'a pas renvoyé d'objet structuré.");
  }
  return result.output;
}
