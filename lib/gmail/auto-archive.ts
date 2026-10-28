import "server-only";

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  emailProposals,
  gmailMessages,
  gmailTags,
  gmailThreads,
  gmailThreadTags,
} from "@/db/schema/gmail";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";
import { listThreadsByLabel } from "@/lib/google/gmail-api";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { requiresAction } from "./action-required";
import { archiveThread } from "./archive";
import { isAutomatedSender } from "./automated-sender";
import { isCalendarMail } from "./calendar-mail";

/**
 * Archivage automatique de la boîte de réception : retirer de l'inbox,
 * jamais supprimer. Deux règles, chacune derrière un réglage :
 *
 *  - `task_done` : toutes les tâches liées au fil (passages verbatim de
 *    `task_sources`, propositions acceptées) sont terminées ou annulées,
 *    au moins une est terminée. Le fil est lu, tous ses messages ont été
 *    extraits, et aucune proposition n'y attend une décision. Un
 *    message arrivé après la clôture ne retient pas le fil à lui seul :
 *    c'est la règle « action attendue » qui tranche (un merci part, une
 *    question reste).
 *  - `automated` : tous les messages viennent d'expéditeurs machines
 *    (cf. automated-sender.ts) et le dernier a plus de N jours. Les mails
 *    d'agenda (invitations, rappels, confirmations de rendez-vous, cf.
 *    calendar-mail.ts) restent en boîte quoi qu'il arrive.
 *
 * Dans les deux cas, un fil où un message attend une action de
 * l'utilisateur reste en boîte : « réponse attendue » posé par l'extraction
 * (`extraction_meta.needsReply`), ou un objet qui l'annonce (cf.
 * action-required.ts : paiement refusé, pièce à signer, compte à
 * confirmer, expiration…).
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

/**
 * Borne les appels Gmail d'un run ; le reste attend la relève suivante
 * (toutes les 15 min). Assez pour vider un arriéré en une soirée, assez
 * peu pour laisser leur budget aux extractions LLM qui suivent.
 */
export const MAX_ARCHIVES_PER_RUN = 60;

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

/** Vrai si un message du fil attend un geste : drapeau de l'extraction, ou objet explicite. */
function demandsAction(m: { subject: string | null; extractionMeta: unknown }): boolean {
  const meta = (m.extractionMeta ?? null) as { needsReply?: unknown } | null;
  return meta?.needsReply === true || requiresAction(m);
}

/** Parmi `threadIds`, ceux où au moins un message attend une action. */
async function threadsDemandingAction(conn: Database, threadIds: string[]): Promise<Set<string>> {
  if (threadIds.length === 0) return new Set();
  const rows = await conn
    .select({
      threadId: gmailMessages.threadId,
      subject: gmailMessages.subject,
      extractionMeta: gmailMessages.extractionMeta,
    })
    .from(gmailMessages)
    .where(inArray(gmailMessages.threadId, threadIds));
  const out = new Set<string>();
  for (const r of rows) if (demandsAction(r)) out.add(r.threadId);
  return out;
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
  const [taskRows, threadRows, pendingRows, unextractedRows] = await Promise.all([
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
    // Un message pas encore passé par l'extraction : on ne sait pas s'il
    // attend une réponse, le fil attend la relève suivante.
    conn
      .selectDistinct({ threadId: gmailMessages.threadId })
      .from(gmailMessages)
      .where(
        and(
          inArray(gmailMessages.threadId, threadIds),
          eq(gmailMessages.extractionStatus, "pending"),
        ),
      ),
  ]);
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const threadById = new Map(threadRows.map((t) => [t.id, t]));
  const hasPending = new Set([...pendingRows, ...unextractedRows].map((r) => r.threadId));

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
    out.push({ threadId, reason: "task_done" });
  }
  // Tâche close ou pas, un message qui attend une réponse garde le fil.
  const demanding = await threadsDemandingAction(
    conn,
    out.map((c) => c.threadId),
  );
  return out.filter((c) => !demanding.has(c.threadId));
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
      extractionMeta: gmailMessages.extractionMeta,
    })
    .from(gmailMessages)
    .where(
      inArray(
        gmailMessages.threadId,
        fresh.map((t) => t.id),
      ),
    );
  // Un seul message humain, d'agenda, ou qui attend une action, et le fil reste.
  const keep = new Set<string>();
  const seen = new Set<string>();
  for (const m of senders) {
    seen.add(m.threadId);
    if (!isAutomatedSender(m) || isCalendarMail(m) || demandsAction(m)) keep.add(m.threadId);
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

/** Fils rejoués par relève pour les relier à leurs tâches terminées : chacun coûte un appel LLM. */
const REQUEUE_PER_RUN = 3;

/**
 * Les fils en boîte extraits avant que le vocabulaire ne liste les tâches
 * terminées n'ont aucun lien avec elles : la règle `task_done` ne les voit
 * pas. On remet en file le dernier message des fils tagués à un seul
 * projet qui a des tâches terminées depuis deux mois, lus, écrits par un
 * humain, sans aucun lien de tâche. L'extraction rejouée ne garde que les
 * passages (`requeuedForDoneTasks`), pas de nouvelle proposition.
 */
export async function requeueThreadsForDoneTasks(
  conn: Database,
  opts: { userId: string; limit?: number },
): Promise<number> {
  const limit = opts.limit ?? REQUEUE_PER_RUN;
  const inbox = inboxThreadIds(conn, opts.userId);
  const projectTags = await conn
    .select({ threadId: gmailThreadTags.threadId, projectId: gmailTags.targetId })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(
      and(
        eq(gmailTags.userId, opts.userId),
        eq(gmailTags.kind, "project"),
        inArray(gmailThreadTags.threadId, inbox),
      ),
    );
  const projectsByThread = new Map<string, Set<string>>();
  for (const r of projectTags) {
    if (!r.projectId) continue;
    const set = projectsByThread.get(r.threadId) ?? new Set<string>();
    set.add(r.projectId);
    projectsByThread.set(r.threadId, set);
  }
  const single = [...projectsByThread.entries()].filter(([, s]) => s.size === 1);
  if (single.length === 0) return 0;

  const projectIds = [...new Set(single.map(([, s]) => [...s][0] as string))];
  const withDone = new Set(
    (
      await conn
        .selectDistinct({ projectId: tasks.projectId })
        .from(tasks)
        .where(
          and(
            inArray(tasks.projectId, projectIds),
            eq(tasks.status, "done"),
            sql`${tasks.completedAt} > now() - interval '60 days'`,
          ),
        )
    ).flatMap((r) => (r.projectId ? [r.projectId] : [])),
  );
  const threadIds = single.filter(([, s]) => withDone.has([...s][0] as string)).map(([id]) => id);
  if (threadIds.length === 0) return 0;

  const [threadRows, linked, msgs] = await Promise.all([
    conn
      .select({ id: gmailThreads.id, hasUnread: gmailThreads.hasUnread })
      .from(gmailThreads)
      .where(inArray(gmailThreads.id, threadIds)),
    conn
      .selectDistinct({ threadId: gmailMessages.threadId })
      .from(taskSources)
      .innerJoin(gmailMessages, eq(gmailMessages.id, taskSources.messageId))
      .where(inArray(gmailMessages.threadId, threadIds)),
    conn
      .select({
        id: gmailMessages.id,
        threadId: gmailMessages.threadId,
        fromEmail: gmailMessages.fromEmail,
        fromName: gmailMessages.fromName,
        internalDate: gmailMessages.internalDate,
        extractionStatus: gmailMessages.extractionStatus,
        extractionMeta: gmailMessages.extractionMeta,
        bodyText: gmailMessages.bodyText,
      })
      .from(gmailMessages)
      .where(inArray(gmailMessages.threadId, threadIds)),
  ]);
  const unread = new Set(threadRows.filter((t) => t.hasUnread).map((t) => t.id));
  const alreadyLinked = new Set(linked.map((r) => r.threadId));

  const byThread = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const arr = byThread.get(m.threadId) ?? [];
    arr.push(m);
    byThread.set(m.threadId, arr);
  }
  const toRequeue: string[] = [];
  for (const [threadId, list] of byThread) {
    if (unread.has(threadId) || alreadyLinked.has(threadId)) continue;
    if (!list.some((m) => !isAutomatedSender(m))) continue;
    const last = [...list].sort(
      (a, b) => (b.internalDate?.getTime() ?? 0) - (a.internalDate?.getTime() ?? 0),
    )[0];
    if (!last || !last.bodyText || last.extractionStatus !== "extracted") continue;
    const meta = (last.extractionMeta ?? null) as { doneTasksSeen?: unknown } | null;
    if (meta?.doneTasksSeen === true) continue;
    toRequeue.push(last.id);
    if (toRequeue.length >= limit) break;
  }
  for (const id of toRequeue) {
    await conn
      .update(gmailMessages)
      .set({
        extractionStatus: "pending",
        extractionMeta: sql`coalesce(${gmailMessages.extractionMeta}, '{}'::jsonb) || '{"requeuedForDoneTasks": true}'::jsonb`,
      })
      .where(eq(gmailMessages.id, id));
  }
  return toRequeue.length;
}

/** Pages de `threads.list` lues au plus pour relever la boîte : 20 × 500 fils. */
const INBOX_LIST_MAX_PAGES = 20;

/**
 * Remet le miroir local d'accord avec Gmail sur ce qui est en boîte. La
 * relève incrémentale ne voit pas toujours un fil rangé à la main il y a
 * des mois ; le miroir le croyait encore en boîte, les aperçus comptaient
 * faux et chaque relève tentait d'archiver du déjà archivé. On lit la
 * liste réelle des fils en boîte et on retire `INBOX` localement aux
 * autres. Si la lecture échoue ou s'arrête avant la fin, on ne touche à
 * rien : une liste incomplète ferait disparaître des fils bien en boîte.
 */
export async function reconcileInboxMirror(
  conn: Database,
  args: { userId: string; accessToken: string },
): Promise<{ forgotten: number; complete: boolean }> {
  const inGmail = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await listThreadsByLabel(args.accessToken, "INBOX", {
      pageToken,
      maxResults: 500,
    });
    for (const t of page.threads ?? []) inGmail.add(t.id);
    pageToken = page.nextPageToken;
    pages++;
  } while (pageToken && pages < INBOX_LIST_MAX_PAGES);
  if (pageToken) return { forgotten: 0, complete: false };

  const local = await conn
    .select({ id: gmailThreads.id, gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.userId, args.userId),
        inArray(gmailThreads.id, inboxThreadIds(conn, args.userId)),
      ),
    );
  const stale = local.filter((t) => !inGmail.has(t.gmailThreadId));
  for (const t of stale) await forgetInbox(conn, t.id);
  return { forgotten: stale.length, complete: true };
}

/** Applique l'archivage à la relève : Gmail d'abord, puis la trace locale. */
export async function runAutoArchive(args: {
  userId: string;
  accessToken: string;
  now?: Date;
  shouldStop?: () => boolean;
}): Promise<{ archived: number; forgotten: number; requeued: number; errors: string[] }> {
  const settings = await getAutoArchiveSettings();
  if (!settings.doneTasks && settings.automatedDays === null) {
    return { archived: 0, forgotten: 0, requeued: 0, errors: [] };
  }
  const conn = await db();
  const errors: string[] = [];
  let forgotten = 0;
  try {
    forgotten = (await reconcileInboxMirror(conn, args)).forgotten;
  } catch (err) {
    errors.push(`inbox mirror: ${err instanceof Error ? err.message : String(err)}`);
  }
  let requeued = 0;
  if (settings.doneTasks) {
    try {
      requeued = await requeueThreadsForDoneTasks(conn, { userId: args.userId });
    } catch (err) {
      errors.push(`requeue done tasks: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const candidates = await selectThreadsToArchive(conn, {
    userId: args.userId,
    settings,
    now: args.now,
  });
  let archived = 0;
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
      const message = err instanceof Error ? err.message : String(err);
      // Le fil n'existe plus chez Gmail (supprimé, corbeille vidée) : le
      // miroir local le croyait encore en boîte. On le sort de la boîte
      // locale pour ne pas le retenter à chaque relève, sans trace
      // d'archivage puisqu'on n'a rien archivé.
      if (/Gmail API 404\b/.test(message)) {
        await forgetInbox(conn, c.threadId);
        continue;
      }
      errors.push(`archive ${c.threadId}: ${message}`);
    }
  }
  return { archived, forgotten, requeued, errors };
}

/** Retire `INBOX` du miroir local d'un fil, sans toucher à Gmail. */
async function forgetInbox(conn: Database, threadId: string): Promise<void> {
  await conn
    .update(gmailThreads)
    .set({ labels: sql`array_remove(${gmailThreads.labels}, 'INBOX')` })
    .where(eq(gmailThreads.id, threadId));
  await conn
    .update(gmailMessages)
    .set({ labels: sql`array_remove(${gmailMessages.labels}, 'INBOX')` })
    .where(eq(gmailMessages.threadId, threadId));
}
