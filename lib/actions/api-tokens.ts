"use server";

import { randomBytes } from "node:crypto";
import { userApiTokens } from "@/db/schema/user-api-tokens";
import { action } from "@/lib/actions/action";
import { hashToken } from "@/lib/db/queries/api-tokens";
import { db } from "@/lib/db/server";
import { createApiTokenSchema, revokeApiTokenSchema } from "@/lib/schemas/api-tokens";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const TOKEN_PREFIX = "paradeos_pat_";

/**
 * Crée un PAT pour le user courant. Le token brut est renvoyé UNE FOIS
 * (à afficher dans l'UI) ; ensuite on n'a plus que son hash.
 */
export const createApiToken = action(createApiTokenSchema, async ({ input, user }) => {
  const random = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${random}`;
  const tokenHash = hashToken(token);

  const conn = await db();
  const [row] = await conn
    .insert(userApiTokens)
    .values({
      userId: user.id,
      label: input.label,
      tokenHash,
    })
    .returning({ id: userApiTokens.id });

  revalidatePath("/settings/integrations");
  return { id: row?.id, token };
});

export const revokeApiToken = action(revokeApiTokenSchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .update(userApiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(userApiTokens.id, input.id), eq(userApiTokens.userId, user.id)));
  revalidatePath("/settings/integrations");
  return { ok: true };
});
