"use server";

import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { updateLlmConfigSchema } from "@/lib/schemas/integrations";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";

/**
 * Met à jour la config LLM globale (clé OpenRouter + modèle).
 * Vide une valeur = chaîne vide → setting supprimé (retombe sur env
 * vars / defaults).
 */
export const updateLlmConfig = action(updateLlmConfigSchema, async ({ input, user }) => {
  await requireAdmin(user);
  // `undefined` = ne pas toucher. `""` = supprimer. Sinon = set.
  if (input.apiKey !== undefined) {
    await setSetting(
      SETTING_KEYS.OPENROUTER_API_KEY,
      input.apiKey === "" ? null : input.apiKey,
      user.id,
    );
  }
  if (input.model !== undefined) {
    await setSetting(SETTING_KEYS.LLM_MODEL, input.model === "" ? null : input.model, user.id);
  }
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});
