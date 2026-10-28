"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

/**
 * Seuil de confirmation sans clic des rapprochements dev (tâche ↔ item de
 * feuille de route, tâche ↔ commit), cf. `DEV_AUTO_CONFIRM_MIN`.
 */
export const setDevAutoConfirmMin = action(
  z.object({ value: z.enum(["off", "0.95", "0.9", "0.8"]) }),
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(SETTING_KEYS.DEV_AUTO_CONFIRM_MIN, input.value, user.id);
    revalidatePath("/settings/integrations");
    return { value: input.value };
  },
);
