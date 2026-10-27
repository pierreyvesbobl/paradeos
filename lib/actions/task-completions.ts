"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

/**
 * Interrupteur de la clôture automatique des tâches (cf.
 * `TASK_AUTOCOMPLETE_ENABLED`). Éteint, les clôtures détectées restent des
 * propositions à valider dans /inbox.
 */
export const setTaskAutocompleteEnabled = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(
      SETTING_KEYS.TASK_AUTOCOMPLETE_ENABLED,
      input.enabled ? "true" : "false",
      user.id,
    );
    revalidatePath("/settings/integrations");
    return { ok: true as const, enabled: input.enabled };
  },
);
