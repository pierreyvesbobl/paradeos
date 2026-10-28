import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Le modèle d'extraction configuré (`app_settings.LLM_MODEL`) via
 * OpenRouter, pour les usages secondaires (rapprochements, classements).
 * L'extraction des réunions garde son propre câblage dans
 * lib/meetings/extract.ts.
 */
export async function getOpenRouterModel(): Promise<{ model: LanguageModel; modelId: string }> {
  const apiKey = await getSetting(SETTING_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error("Clé OpenRouter non configurée. Ajoute-la dans /settings/integrations.");
  }
  const modelId = (await getSetting(SETTING_KEYS.LLM_MODEL)) ?? DEFAULT_LLM_MODEL;
  const openrouter = createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://paradeos.vercel.app",
      "X-Title": "Paradeos",
    },
  });
  return { model: openrouter(modelId), modelId };
}
