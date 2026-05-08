import { z } from "zod";

/**
 * Modèle LLM par défaut sur OpenRouter si rien de configuré (équivalent
 * fonctionnel à l'ancien `gpt-4.1` direct OpenAI).
 *
 * Vit ici (et pas dans `lib/settings.ts` qui est `server-only`) pour
 * être importable depuis les composants client.
 */
export const DEFAULT_LLM_MODEL = "openai/gpt-4.1";

export const updateLlmConfigSchema = z.object({
  /**
   * Clé API OpenRouter. `undefined` = ne pas toucher (utile pour
   * sauvegarder uniquement le modèle). `""` = supprimer.
   */
  apiKey: z
    .string()
    .trim()
    .max(300, "Clé trop longue.")
    .refine(
      (v) => v === "" || /^sk-or-[A-Za-z0-9_-]{10,}$/.test(v) || /^sk-[A-Za-z0-9_-]{20,}$/.test(v),
      "Format OpenRouter attendu : `sk-or-v1-…`.",
    )
    .optional(),
  model: z
    .string()
    .trim()
    .max(120)
    .refine(
      (v) => v === "" || /^[a-z0-9._-]+\/[a-z0-9._-]+(:[a-z0-9_-]+)?$/i.test(v),
      "Format attendu : `provider/model` (ex. `anthropic/claude-sonnet-4`).",
    )
    .optional(),
});

export type UpdateLlmConfigInput = z.infer<typeof updateLlmConfigSchema>;
