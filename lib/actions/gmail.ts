"use server";

import { gmailSyncState, gmailTags, gmailThreadTags } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { cleanupSpamThreads, purgeGmailData, syncIncremental } from "@/lib/gmail/sync";
import {
  applyTagToThread,
  autoTagThreadByParticipants,
  backfillCrmTags,
  createCategoryTag,
  deleteTag,
  ensureCrmTag,
  removeTagFromThread,
  renameTag,
} from "@/lib/gmail/tags";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { and, eq } from "drizzle-orm";
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
    skippedSpam: result.skippedSpam,
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

/**
 * Retagge un thread avec un projet (ou détache) et scelle le choix
 * humain : le nouveau tag est marqué `manuallyOverridden=true` pour que
 * l'auto-tagging suivant ne remplace pas le projet choisi. Supprime
 * tous les autres tags projet du thread au passage (mono-projet par
 * thread en V1).
 */
export const retagThreadProject = action(
  z.object({
    threadId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
  }),
  async ({ input, user }) => {
    const conn = await db();
    const targetUserId = (await getGmailUserId()) ?? user.id;

    // Retire tous les tags projet existants sur ce thread (avec push
    // Gmail best-effort pour synchroniser les labels).
    const currentProjectTags = await conn
      .select({ tagId: gmailTags.id })
      .from(gmailThreadTags)
      .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
      .where(and(eq(gmailThreadTags.threadId, input.threadId), eq(gmailTags.kind, "project")));
    for (const t of currentProjectTags) {
      await removeTagFromThread({
        userId: targetUserId,
        threadIdLocal: input.threadId,
        tagId: t.tagId,
      });
    }

    // Applique le nouveau projet si demandé.
    if (input.projectId) {
      const [project] = await conn
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project) throw new Error("Projet introuvable.");
      const tag = await ensureCrmTag({
        userId: targetUserId,
        kind: "project",
        targetId: project.id,
        displayName: project.name,
      });
      await conn
        .insert(gmailThreadTags)
        .values({
          threadId: input.threadId,
          tagId: tag.id,
          source: "manual",
          manuallyOverridden: true,
          createdBy: user.id,
        })
        .onConflictDoUpdate({
          target: [gmailThreadTags.threadId, gmailThreadTags.tagId],
          set: { source: "manual", manuallyOverridden: true, createdBy: user.id },
        });
      try {
        await applyTagToThread({
          userId: targetUserId,
          threadIdLocal: input.threadId,
          tagId: tag.id,
          source: "manual",
          createdBy: user.id,
        });
      } catch {
        // Push Gmail best-effort ; le tag DB est déjà posé.
      }
    }

    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    revalidatePath("/projets");
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

/**
 * Nettoie les threads déjà importés dont tous les messages sont SPAM
 * ou TRASH (utile une fois après le déploiement du filtrage à l'ingestion).
 */
export const cleanupSpamAction = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const r = await cleanupSpamThreads(targetUserId);
  revalidatePath("/emails");
  revalidatePath("/settings/integrations");
  return r;
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

/** Toggle l'extraction LLM des emails (kill switch coût). */
export const setGmailExtractionEnabled = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await setSetting(
      SETTING_KEYS.GMAIL_EXTRACTION_ENABLED,
      input.enabled ? "true" : "false",
      user.id,
    );
    revalidatePath("/settings/integrations");
    return { ok: true as const, enabled: input.enabled };
  },
);

// Alias gardés pour compat avec les composants UI (à supprimer plus tard).
export { triggerGmailSync as syncGmail };
