"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

/**
 * Interrupteur des créneaux posés sans clic depuis les rendez-vous reconnus
 * (cf. `CALENDAR_AUTO_TIME_ENABLED`). Éteint, les rendez-vous reconnus
 * restent à imputer d'un clic dans la grille de /temps.
 */
export const setCalendarAutoTimeEnabled = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(
      SETTING_KEYS.CALENDAR_AUTO_TIME_ENABLED,
      input.enabled ? "true" : "false",
      user.id,
    );
    revalidatePath("/settings/integrations");
    return { ok: true as const, enabled: input.enabled };
  },
);
