"use server";

import { gmailSyncState } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { purgeGmailData, syncIncremental } from "@/lib/gmail/sync";
import {
  applyTagToThread,
  autoTagThreadByParticipants,
  backfillCrmTags,
  createCategoryTag,
  deleteTag,
  removeTagFromThread,
  renameTag,
} from "@/lib/gmail/tags";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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

export const triggerGmailSync = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const result = await syncIncremental(targetUserId);
  revalidatePath("/emails");
  revalidatePath("/settings/integrations");
  return {
    mode: result.mode,
    inserted: result.inserted,
    bodiesFetched: result.bodiesFetched,
    skippedNotFound: result.skippedNotFound,
    hasMore: result.hasMore,
    errors: result.errors,
  };
});

// ─── Tags : appliquer / retirer sur un thread ─────────────────────────

export const addTagToThread = action(
  z.object({
    threadId: z.string().uuid(),
    tagId: z.string().uuid(),
  }),
  async ({ input, user }) => {
    const targetUserId = (await getGmailUserId()) ?? user.id;
    await applyTagToThread({
      userId: targetUserId,
      threadIdLocal: input.threadId,
      tagId: input.tagId,
      source: "manual",
      createdBy: user.id,
    });
    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    return { ok: true as const };
  },
);

export const removeTagAction = action(
  z.object({
    threadId: z.string().uuid(),
    tagId: z.string().uuid(),
  }),
  async ({ input, user }) => {
    const targetUserId = (await getGmailUserId()) ?? user.id;
    await removeTagFromThread({
      userId: targetUserId,
      threadIdLocal: input.threadId,
      tagId: input.tagId,
    });
    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    return { ok: true as const };
  },
);

// ─── CRUD catégories ──────────────────────────────────────────────────

export const createCategoryTagAction = action(
  z.object({
    name: z.string().min(1).max(80),
    color: z.string().optional(),
  }),
  async ({ input, user }) => {
    const targetUserId = (await getGmailUserId()) ?? user.id;
    const tag = await createCategoryTag({
      userId: targetUserId,
      name: input.name,
      color: input.color,
    });
    revalidatePath("/emails/tags");
    revalidatePath("/emails");
    return tag;
  },
);

export const renameTagAction = action(
  z.object({
    tagId: z.string().uuid(),
    newName: z.string().min(1).max(80),
  }),
  async ({ input, user }) => {
    const targetUserId = (await getGmailUserId()) ?? user.id;
    await renameTag({ userId: targetUserId, tagId: input.tagId, newName: input.newName });
    revalidatePath("/emails/tags");
    return { ok: true as const };
  },
);

export const deleteTagAction = action(
  z.object({ tagId: z.string().uuid() }),
  async ({ input, user }) => {
    const targetUserId = (await getGmailUserId()) ?? user.id;
    await deleteTag(targetUserId, input.tagId);
    revalidatePath("/emails/tags");
    revalidatePath("/emails");
    return { ok: true as const };
  },
);

// ─── Backfill / réindex / purge ───────────────────────────────────────

export const backfillCrmTagsAction = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const stats = await backfillCrmTags(targetUserId);
  revalidatePath("/emails/tags");
  revalidatePath("/settings/integrations");
  return stats;
});

export const rebuildAutoLinks = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  // Re-tag tous les threads du user via les participants.
  const conn = await db();
  const { gmailThreads } = await import("@/db/schema/gmail");
  const rows = await conn
    .select({ id: gmailThreads.id })
    .from(gmailThreads)
    .where(eq(gmailThreads.userId, targetUserId));
  for (const r of rows) {
    try {
      await autoTagThreadByParticipants(r.id);
    } catch {
      // continue
    }
  }
  revalidatePath("/emails");
  return { rebuilt: rows.length };
});

export const purgeLocalGmail = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  await purgeGmailData(targetUserId);
  const conn = await db();
  await conn.delete(gmailSyncState).where(eq(gmailSyncState.userId, targetUserId));
  revalidatePath("/emails");
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});

// Alias gardés pour compat avec les composants UI (à supprimer plus tard).
export { triggerGmailSync as syncGmail };
