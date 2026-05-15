"use server";

import { randomBytes } from "node:crypto";
import { dougsSyncTokens } from "@/db/schema/dougs";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { DOUGS_SYNC_TOKEN_PREFIX, hashSyncToken } from "@/lib/dougs/sync-tokens";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const createSchema = z.object({
  label: z.string().trim().min(1, "Label requis.").max(80),
});

const revokeSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Crée un token de synchro Dougs utilisé par l'extension Chrome. Token
 * brut renvoyé UNE FOIS (à coller dans la popup de l'extension).
 */
export const createDougsSyncToken = action(createSchema, async ({ input, user }) => {
  const random = randomBytes(32).toString("base64url");
  const token = `${DOUGS_SYNC_TOKEN_PREFIX}${random}`;
  const tokenHash = hashSyncToken(token);

  const conn = await db();
  const [row] = await conn
    .insert(dougsSyncTokens)
    .values({ userId: user.id, label: input.label, tokenHash })
    .returning({ id: dougsSyncTokens.id });

  revalidatePath("/settings/integrations");
  return { id: row?.id, token };
});

export const revokeDougsSyncToken = action(revokeSchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .update(dougsSyncTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(dougsSyncTokens.id, input.id), eq(dougsSyncTokens.userId, user.id)));
  revalidatePath("/settings/integrations");
  return { ok: true };
});
