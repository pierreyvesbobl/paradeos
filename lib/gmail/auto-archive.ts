import "server-only";

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { archiveThread } from "./archive";
import { isAutomatedSender } from "./automated-sender";
import { isCalendarMail } from "./calendar-mail";

/**
 * Archivage automatique de la boîte de réception : retirer de l'inbox,
 * jamais supprimer. Deux règles, chacune derrière un réglage :
 *
 *  - `task_done` : toutes les tâches liées au fil (passages verbatim de
 *    `task_sources`, propositions acceptées) sont terminées ou annulées,
 *    au moins une est terminée, et rien n'est arrivé dans le fil depuis.
 *    Le fil est lu, et aucune proposition n'y attend une décision.
 *  - `automated` : tous les messages viennent d'expéditeurs machines
 *    (cf. automated-sender.ts) et le dernier a plus de N jours. Les mails
 *    d'agenda (invitations, rappels, confirmations de rendez-vous, cf.
 *    calendar-mail.ts) restent en boîte quoi qu'il arrive.
 *
 * Un fil déjà archivé par ici n'est repris que si un message plus récent
 * est arrivé : remettre un fil en boîte à la main tient.
 */

export type AutoArchiveReason = "task_done" | "automated";

export const AUTOMATED_DAYS_CHOICES: { value: string; label: string }[] = [
  { value: "off", label: "Jamais" },
  { value: "3", label: "Après 3 jours" },
  { value: "7", label: "Après 7 jours" },
  { value: "14", label: "Après 14 jours" },
];

/** Borne les appels Gmail d'un run ; le reste attend la relève suivante. */
export const MAX_ARCHIVES_PER_RUN = 100;

export type AutoArchiveSettings = {
  doneTasks: boolean;
  /** Âge minimal en jours des fils de robots, ou null si la règle est coupée. */
  automatedDays: number | null;
};

export async function getAutoArchiveSettings(): Promise<AutoArchiveSettings> {
  const [done, automated] = await Promise.all([
    getSetting(SETTING_KEYS.GMAIL_ARCHIVE_DONE_TASKS),
    getSetting(SETTING_KEYS.GMAIL_ARCHIVE_AUTOMATED_DAYS),
  ]);
  const days = automated && automated !== "off" ? Number(automated) : Number.NaN;
  return {
    doneTasks: done !== "false",
    automatedDays: Number.isFinite(days) && days > 0 ? days : null,
  };
}

export type ArchiveCandidate = { threadId: string; reason: AutoArchiveReason };

const inInbox = sql`'INBOX' = any(${gmailMessages.labels})`;

/** Fils de l'utilisateur ayant au moins un message encore en boîte de réception. */
function inboxThreadIds(conn: Database, userId: string) {
  return conn
    .selectDistinct({ id: gmailMessages.threadId })
    .from(gmailMessages)
    .where(and(eq(gmailMessages.userId, userId), inInbox));
}

/** Fils dont toutes les tâches liées sont closes et dont rien n'est arrivé depuis. */
export async function selectDoneTaskThreads(
  conn: Database,
  opts: { userId: string },
): Promise<ArchiveCandidate[]> {
  const inbox = inboxThreadIds(conn, opts.userId);

  // Trois façons pour un fil de pointer une tâche.
  const fromSources = conn
    .select({ threadId: gmailMessages.threadId, taskId: taskSources.taskId })
    .from(taskSources)
    .innerJoin(gmailMessages, eq(gmailMessages.id, taskSources.messageId))
    .where(inArray(gmailMessages.threadId, inbox));
  const fromCreated = conn
    .select({
      threadId: gmailMessages.threadId,
      taskId: sql<string>`${emailProposals.createdEntityId}`.as("task_id"),
    })
    .from(emailProposals)
    .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
    .where(
      and(
        inArray(gmailMessages.threadId, inbox),
        eq(emailProposals.kind, "task"),
        eq(emailProposals.status, "accepted"),
        isNotNull(emailProposals.createdEntityId),
      ),
    );
  const fromCompleted = conn
    .select({
      threadId: gmailMessages.threadId,
      taskId: sql<string>`${emailProposals.matchedId}`.as("task_id"),
    })
    .from(emailProposals)
    .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
    .where(
      and(
        inArray(gmailMessages.threadId, inbox),
        eq(emailProposals.kind, "task_completion"),
        eq(emailProposals.status, "accepted"),
        isNotNull(emailProposals.matchedId),
      ),
    );
  const linkRows = [
    ...(await fromSources),
    ...(await fromCreated),
    ...(await fromCompleted),
  ].filter((r): r is { threadId: string; taskId: string } => Boolean(r.taskId));
  if (linkRows.length === 0) return [];

  const taskIds = [...new Set(linkRows.map((r) => r.taskId))];
  const threadIds = [...new Set(linkRows.map((r) => r.threadId))];
  const [taskRows, threadRows, pendingRows] = await Promise.all([
    conn
      .select({ id: tasks.id, status: tasks.status, completedAt: tasks.completedAt })
      .from(tasks)
      .where(inArray(tasks.id, taskIds)),
    conn
      .select({
        id: gmailThreads.id,
        hasUnread: gmailThreads.hasUnread,
        lastMessageAt: gmailThreads.lastMessageAt,
        autoArchivedAt: gmailThreads.autoArchivedAt,
      })
      .from(gmailThreads)
      .where(inArray(gmailThreads.id, threadIds)),
    conn
      .selectDistinct({ threadId: gmailMessages.threadId })
      .from(emailProposals)
      .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
      .where(and(inArray(gmailMessages.threadId, threadIds), eq(emailProposals.status, "pending"))),
  ]);
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const threadById = new Map(threadRows.map((t) => [t.id, t]));
  const hasPending = new Set(pendingRows.map((r) => r.threadId));

  const tasksByThread = new Map<string, Set<string>>();
  for (const r of linkRows) {
    const set = tasksByThread.get(r.threadId) ?? new Set<string>();
    set.add(r.taskId);
    tasksByThread.set(r.threadId, set);
  }

  const out: ArchiveCandidate[] = [];
  for (const [threadId, ids] of tasksByThread) {
    const thread = threadById.get(threadId);
    if (!thread || thread.hasUnread || hasPending.has(threadId)) continue;
    if (!isNewerThanArchive(thread.lastMessageAt, thread.autoArchivedAt)) continue;
    let allClosed = true;
    let lastDone: Date | null = null;
    for (const id of ids) {
      const t = taskById.get(id);
      if (!t || (t.status !== "done" && t.status !== "cancelled")) {
        allClosed = false;
        break;
      }
      if (t.status === "done") {
        const at = t.completedAt;
        if (at && (!lastDone || at > lastDone)) lastDone = at;
      }
    }
    if (!allClosed || !lastDone) continue;
    // Un message arrivé après la clôture peut rouvrir le sujet : on le laisse.
    if (thread.lastMessageAt && thread.lastMessageAt > lastDone) continue;
    out.push({ threadId, reason: "task_done" });
  }
  return out;
}

/** Fils de robots dont le dernier message a plus de `days` jours. */
export async function selectAutomatedThreads(
  conn: Database,
  opts: { userId: string; days: number; now?: Date; limit?: number },
): Promise<ArchiveCandidate[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.days * 86_400_000);
  const threads = await conn
    .select({
      id: gmailThreads.id,
      lastMessageAt: gmailThreads.lastMessageAt,
      autoArchivedAt: gmailThreads.autoArchivedAt,
    })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.userId, opts.userId),
        lt(gmailThreads.lastMessageAt, cutoff),
        inArray(gmailThreads.id, inboxThreadIds(conn, opts.userId)),
      ),
    )
    .orderBy(gmailThreads.lastMessageAt);
  const fresh = threads.filter((t) => isNewerThanArchive(t.lastMessageAt, t.autoArchivedAt));
  if (fresh.length === 0) return [];

  const senders = await conn
    .select({
      threadId: gmailMessages.threadId,
      fromEmail: gmailMessages.fromEmail,
      fromName: gmailMessages.fromName,
      subject: gmailMessages.subject,
    })
    .from(gmailMessages)
    .where(
      inArray(
        gmailMessages.threadId,
        fresh.map((t) => t.id),
      ),
    );
  // Un seul message humain, ou un seul mail d'agenda, et le fil reste.
  const keep = new Set<string>();
  const seen = new Set<string>();
  for (const m of senders) {
    seen.add(m.threadId);
    if (!isAutomatedSender(m) || isCalendarMail(m)) keep.add(m.threadId);
  }
  const limit = opts.limit ?? MAX_ARCHIVES_PER_RUN;
  return fresh
    .filter((t) => seen.has(t.id) && !keep.has(t.id))
    .slice(0, limit)
    .map((t) => ({ threadId: t.id, reason: "automated" as const }));
}

/** Vrai si le fil n'a jamais été archivé par ici, ou a reçu un message depuis. */
function isNewerThanArchive(lastMessageAt: Date | null, autoArchivedAt: Date | null): boolean {
  if (!autoArchivedAt) return true;
  return Boolean(lastMessageAt && lastMessageAt > autoArchivedAt);
}

/** Les deux règles, selon les réglages, bornées à `MAX_ARCHIVES_PER_RUN`. */
export async function selectThreadsToArchive(
  conn: Database,
  opts: { userId: string; settings: AutoArchiveSettings; now?: Date },
): Promise<ArchiveCandidate[]> {
  const out: ArchiveCandidate[] = [];
  if (opts.settings.doneTasks) out.push(...(await selectDoneTaskThreads(conn, opts)));
  if (opts.settings.automatedDays !== null) {
    const remaining = MAX_ARCHIVES_PER_RUN - out.length;
    if (remaining > 0) {
      const seen = new Set(out.map((c) => c.threadId));
      const automated = await selectAutomatedThreads(conn, {
        userId: opts.userId,
        days: opts.settings.automatedDays,
        now: opts.now,
        limit: remaining,
      });
      for (const c of automated) if (!seen.has(c.threadId)) out.push(c);
    }
  }
  return out.slice(0, MAX_ARCHIVES_PER_RUN);
}

/** Applique l'archivage à la relève : Gmail d'abord, puis la trace locale. */
export async function runAutoArchive(args: {
  userId: string;
  accessToken: string;
  now?: Date;
  shouldStop?: () => boolean;
}): Promise<{ archived: number; errors: string[] }> {
  const settings = await getAutoArchiveSettings();
  if (!settings.doneTasks && settings.automatedDays === null) return { archived: 0, errors: [] };
  const conn = await db();
  const candidates = await selectThreadsToArchive(conn, {
    userId: args.userId,
    settings,
    now: args.now,
  });
  let archived = 0;
  const errors: string[] = [];
  for (const c of candidates) {
    if (args.shouldStop?.()) break;
    try {
      const r = await archiveThread({ accessToken: args.accessToken, threadIdLocal: c.threadId });
      if (!r.archived) continue;
      await conn
        .update(gmailThreads)
        .set({ autoArchivedAt: args.now ?? new Date(), autoArchiveReason: c.reason })
        .where(eq(gmailThreads.id, c.threadId));
      archived++;
    } catch (err) {
      errors.push(`archive ${c.threadId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { archived, errors };
}
