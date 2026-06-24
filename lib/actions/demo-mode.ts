"use server";

import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const toggleDemoMode = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(SETTING_KEYS.DEMO_MODE, input.enabled ? "true" : null, user.id);
    revalidatePath("/", "layout");
    return { ok: true as const, enabled: input.enabled };
  },
);
