import "server-only";

import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { cache } from "react";

/**
 * `true` si le mode démo est activé globalement (clé `app_settings.DEMO_MODE`).
 * Mémoïsé par requête via `React.cache` — un seul aller-retour DB par render.
 */
export const isDemoMode = cache(async (): Promise<boolean> => {
  try {
    const v = await getSetting(SETTING_KEYS.DEMO_MODE);
    return v === "true";
  } catch {
    return false;
  }
});
