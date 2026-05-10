"use server";

import { dougsSessions } from "@/db/schema/dougs";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { encryptCookie } from "@/lib/dougs/crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const connectSchema = z.object({
  cookie: z
    .string()
    .trim()
    .min(20, "Le cookie semble trop court — vérifie que tu as bien copié toute la chaîne."),
  companyId: z.string().trim().regex(/^\d+$/, "companyId doit être numérique.").default("107610"),
});

/**
 * Connecte (ou rafraîchit) la session Dougs pour le user courant.
 * Le cookie est chiffré AES-256-GCM avant stockage. Expiration estimée
 * à 24h (Dougs ne nous le dit pas explicitement).
 */
export const connectDougsSession = action(connectSchema, async ({ input, user }) => {
  const conn = await db();
  const encrypted = encryptCookie(input.cookie);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [existing] = await conn
    .select({ id: dougsSessions.id })
    .from(dougsSessions)
    .where(eq(dougsSessions.userId, user.id))
    .limit(1);

  if (existing) {
    await conn
      .update(dougsSessions)
      .set({
        cookieEncrypted: encrypted,
        companyId: input.companyId,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(dougsSessions.id, existing.id));
  } else {
    await conn.insert(dougsSessions).values({
      userId: user.id,
      cookieEncrypted: encrypted,
      companyId: input.companyId,
      expiresAt,
    });
  }

  revalidatePath("/settings/integrations");
  return { ok: true as const };
});

export const disconnectDougsSession = action(z.object({}), async ({ user }) => {
  const conn = await db();
  await conn.delete(dougsSessions).where(eq(dougsSessions.userId, user.id));
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});
