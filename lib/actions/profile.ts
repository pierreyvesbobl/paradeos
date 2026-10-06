"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { updateProfileSchema } from "@/lib/schemas/profile";

export const updateProfile = action(
  updateProfileSchema,
  async ({ input, user }) => {
    const conn = await db();
    await conn
      .update(users)
      .set({
        fullName: input.fullName,
        costRateHourly: input.costRateHourly != null ? input.costRateHourly.toString() : null,
      })
      .where(eq(users.id, user.id));

    revalidatePath("/settings/profile");
    revalidatePath("/");
    return { ok: true as const };
  },
  { allowViewer: true },
);
