"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { candidatureReplies } from "@/db/schema/candidature-replies";
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db/server";
import { processPendingCandidatures } from "@/lib/gmail/candidature-filer";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

async function getGmailUserId(): Promise<string | null> {
  const conn = await db();
  const rows = await conn
    .select({ id: users.id, scopes: googleAccounts.scopes })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.role, "admin"));
  for (const r of rows) {
    if (hasRequiredGmailScopes(r.scopes)) return r.id;
  }
  return null;
}

export const setCandidatureAutoReplyEnabled = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(
      SETTING_KEYS.CANDIDATURE_AUTOREPLY_ENABLED,
      input.enabled ? "true" : "false",
      user.id,
    );
    revalidatePath("/settings/integrations");
    return { ok: true as const, enabled: input.enabled };
  },
);

/** Expéditeur et corps de la réponse. Une valeur vide rétablit le défaut. */
export const setCandidatureReplyTemplate = action(
  z.object({
    from: z.string().max(200),
    body: z.string().max(5_000),
  }),
  async ({ input, user }) => {
    await requireAdmin(user);
    const from = input.from.trim();
    if (from && !/^.*<[^@\s<>]+@[^@\s<>]+>$/.test(from) && !/^[^@\s<>]+@[^@\s<>]+$/.test(from)) {
      return {
        ok: false as const,
        message: "L'expéditeur doit être une adresse, ou « Nom <adresse> ».",
      };
    }
    await setSetting(SETTING_KEYS.CANDIDATURE_REPLY_FROM, from || null, user.id);
    await setSetting(SETTING_KEYS.CANDIDATURE_REPLY_BODY, input.body.trim() || null, user.id);
    revalidatePath("/settings/integrations");
    return { ok: true as const };
  },
);

/** Traite les candidatures en attente sans attendre le sync du matin. */
export const processPendingCandidatureReplies = action(z.object({}), async ({ user }) => {
  await requireAdmin(user);
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const stats = await processPendingCandidatures(targetUserId, 20);
  revalidatePath("/settings/integrations");
  return { ok: true as const, ...stats };
});

/** Remet une candidature en erreur dans la file. */
export const retryCandidatureReply = action(
  z.object({ replyId: z.string().uuid() }),
  async ({ input, user }) => {
    await requireAdmin(user);
    const conn = await db();
    await conn
      .update(candidatureReplies)
      .set({ status: "pending", errorMessage: null, updatedAt: new Date() })
      .where(and(eq(candidatureReplies.id, input.replyId), eq(candidatureReplies.status, "error")));
    revalidatePath("/settings/integrations");
    return { ok: true as const };
  },
);
