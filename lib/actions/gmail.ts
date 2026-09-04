"use server";

import { gmailSyncState } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  autoLinkThreadByParticipants,
  backfillCrmLabels,
  dismissThreadLinksOfKind,
  ensureCrmLabel,
  linkThread,
  unlinkThread,
} from "@/lib/gmail/links";
import { pullLabeledThreadsFromGmail } from "@/lib/gmail/pull-labels";
import { cleanupSpamThreads, purgeGmailData, syncIncremental } from "@/lib/gmail/sync";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
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
    skippedSpam: result.skippedSpam,
    hasMore: result.hasMore,
    errors: result.errors,
  };
});

// ─── Liaison projet d'un thread ───────────────────────────────────────

/**
 * Rattache un thread à un projet, ou l'en détache. C'est la seule
 * manière de toucher une liaison à la main : il n'y a pas d'UI de
 * tagging — le libellé Gmail n'est que la conséquence de cette décision.
 *
 * Dans les deux sens, la décision est scellée (`manuallyOverridden`) pour
 * que l'auto-link ne la contredise pas au sync suivant :
 *   - projectId défini  → « c'est ce projet » ; les autres liaisons
 *     projet du thread sont invalidées (mono-projet par thread en V1).
 *   - projectId null    → « aucun projet » ; toutes les liaisons projet
 *     du thread sont invalidées et le label Gmail retiré.
 */
export const setThreadProject = action(
  z.object({
    threadId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
  }),
  async ({ input, user }) => {
    const conn = await db();
    const targetUserId = (await getGmailUserId()) ?? user.id;

    // Invalide les liaisons projet existantes (push Gmail best-effort).
    await dismissThreadLinksOfKind({
      userId: targetUserId,
      threadIdLocal: input.threadId,
      kind: "project",
      decidedBy: user.id,
    });

    if (input.projectId) {
      const [project] = await conn
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project) throw new Error("Projet introuvable.");
      const label = await ensureCrmLabel({
        userId: targetUserId,
        kind: "project",
        targetId: project.id,
        displayName: project.name,
      });
      try {
        await linkThread({
          userId: targetUserId,
          threadIdLocal: input.threadId,
          labelId: label.id,
          source: "manual",
          decidedBy: user.id,
          seal: true,
        });
      } catch {
        // Push Gmail best-effort ; la liaison est déjà en base.
      }
    }

    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    revalidatePath("/projets");
    return { ok: true as const };
  },
);

/**
 * Invalide une liaison précise d'un thread (entité rattachée à tort,
 * par exemple). Décision négative : la liaison est scellée, donc le
 * prochain sync ne la reposera pas, et le label Gmail est retiré.
 */
export const dismissThreadLink = action(
  z.object({
    threadId: z.string().uuid(),
    labelId: z.string().uuid(),
  }),
  async ({ input, user }) => {
    const targetUserId = (await getGmailUserId()) ?? user.id;
    await unlinkThread({
      userId: targetUserId,
      threadIdLocal: input.threadId,
      labelId: input.labelId,
      seal: true,
      decidedBy: user.id,
    });
    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    revalidatePath("/entites");
    return { ok: true as const };
  },
);

/**
 * Rapatrie les mails que tu as rangés à la main dans Gmail sous un label
 * `Paradeos/Projets/…` ou `Paradeos/Entités/…`. C'est le seul chemin qui
 * voit les fils dormants : le sync, lui, ne lit les labels que des
 * threads ayant reçu un nouveau message.
 */
export const pullGmailLabels = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const r = await pullLabeledThreadsFromGmail(targetUserId);
  revalidatePath("/emails");
  revalidatePath("/projets");
  revalidatePath("/entites");
  revalidatePath("/settings/integrations");
  return r;
});

// ─── Backfill / réindex / purge ───────────────────────────────────────

/**
 * Recalcule les liaisons automatiques de tous les threads. Deux étapes :
 *   1. s'assurer qu'un libellé Paradeos existe pour chaque projet/entité,
 *      et que son label Gmail porte bien le nom courant du record (sinon
 *      l'auto-link n'a rien à poser, ou pose un label périmé) ;
 *   2. rejouer l'auto-link sur chaque thread — sans jamais rétablir une
 *      liaison que l'utilisateur a invalidée.
 */
export const rebuildAutoLinks = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const backfill = await backfillCrmLabels(targetUserId);
  const conn = await db();
  const { gmailThreads } = await import("@/db/schema/gmail");
  const rows = await conn
    .select({ id: gmailThreads.id })
    .from(gmailThreads)
    .where(eq(gmailThreads.userId, targetUserId));
  for (const r of rows) {
    try {
      await autoLinkThreadByParticipants(r.id);
    } catch {
      // continue
    }
  }
  revalidatePath("/emails");
  revalidatePath("/settings/integrations");
  return {
    rebuilt: rows.length,
    labelsCreated: backfill.labelsCreated,
    labelsRenamed: backfill.labelsRenamed,
  };
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
