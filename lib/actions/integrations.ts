"use server";

import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { updateOpenAiKeySchema } from "@/lib/schemas/integrations";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";

export const updateOpenAiKey = action(updateOpenAiKeySchema, async ({ input, user }) => {
  await requireAdmin(user);
  await setSetting(SETTING_KEYS.OPENAI_API_KEY, input.apiKey === "" ? null : input.apiKey, user.id);
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});
