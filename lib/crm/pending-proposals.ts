import "server-only";

import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import {
  PROPOSAL_REF_PREFIX,
  proposalIdFromTaskId,
  type ResolvedTaskCompletion,
} from "@/lib/meetings/completed-tasks";
import type { PendingProposalEntry } from "@/lib/meetings/extract";

/**
 * Propositions de tâche encore en attente que le LLM voit comme des
 * tâches à clore quand il lit un nouveau contenu. Une proposition née
 * d'un mail ou d'une réunion peut être rendue sans objet par un mail ou
 * une réunion suivante du même projet : la mécanique est la même dans
 * les deux sens. L'identifiant porte sa table : `email:<id>` ou
 * `meeting:<id>`, sous le préfixe `proposal:` du vocabulaire.
 */

const MAX_PENDING_PROPOSALS = 60;

type Source = "email" | "meeting";

export function pendingProposalRef(source: Source, id: string): string {
  return `${source}:${id}`;
}

/** `proposal:email:<id>` → `{ source: "email", id }`, null pour une vraie tâche. */
export function parseProposalRef(taskId: string): { source: Source; id: string } | null {
  const raw = proposalIdFromTaskId(taskId);
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep < 0) return null;
  const source = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if ((source !== "email" && source !== "meeting") || !id) return null;
  return { source, id };
}

function titleOf(payload: unknown): string | null {
  const title = (payload as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() ? title : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Propositions en attente à passer au vocabulaire : celles du fil (pour
 * un mail), et celles du projet, mails et réunions confondus. La source
 * en cours d'extraction est exclue : ses propositions en attente sont
 * effacées puis reposées par la passe.
 */
export async function loadPendingTaskProposals(
  conn: Database,
  opts: {
    projectId: string | null;
    threadId?: string | null;
    excludeMessageId?: string;
    excludeMeetingId?: string;
    limit?: number;
  },
): Promise<PendingProposalEntry[]> {
  const limit = opts.limit ?? MAX_PENDING_PROPOSALS;
  const out: PendingProposalEntry[] = [];
  const seen = new Set<string>();

  const emailScope = [
    opts.threadId ? eq(gmailMessages.threadId, opts.threadId) : null,
    opts.projectId ? sql`${emailProposals.payload}->>'projectId' = ${opts.projectId}` : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  if (emailScope.length > 0) {
    const rows = await conn
      .select({
        id: emailProposals.id,
        payload: emailProposals.payload,
        createdAt: emailProposals.createdAt,
      })
      .from(emailProposals)
      .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
      .where(
        and(
          eq(emailProposals.kind, "task"),
          eq(emailProposals.status, "pending"),
          opts.excludeMessageId ? ne(emailProposals.messageId, opts.excludeMessageId) : undefined,
          or(...emailScope),
        ),
      )
      .orderBy(emailProposals.createdAt)
      .limit(limit);
    for (const r of rows) {
      const title = titleOf(r.payload);
      if (!title) continue;
      const id = pendingProposalRef("email", r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const pl = r.payload as { projectId?: unknown; projectName?: unknown };
      out.push({ id, title, projectId: str(pl.projectId), projectName: str(pl.projectName) });
    }
  }

  if (opts.projectId) {
    const rows = await conn
      .select({ id: meetingProposals.id, payload: meetingProposals.payload })
      .from(meetingProposals)
      .innerJoin(meetings, eq(meetings.id, meetingProposals.meetingId))
      .where(
        and(
          eq(meetingProposals.kind, "task"),
          eq(meetingProposals.status, "pending"),
          opts.excludeMeetingId ? ne(meetingProposals.meetingId, opts.excludeMeetingId) : undefined,
          or(
            eq(meetings.projectId, opts.projectId),
            sql`${meetingProposals.payload}->>'projectId' = ${opts.projectId}`,
          ),
        ),
      )
      .orderBy(meetingProposals.createdAt)
      .limit(limit);
    for (const r of rows) {
      const title = titleOf(r.payload);
      if (!title) continue;
      const id = pendingProposalRef("meeting", r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const pl = r.payload as { projectId?: unknown; projectName?: unknown };
      out.push({
        id,
        title,
        projectId: str(pl.projectId) ?? opts.projectId,
        projectName: str(pl.projectName),
      });
    }
  }

  return out.slice(0, limit);
}

/**
 * Clôt les propositions que le contenu donne pour faites ou sans objet :
 * statut `expired`, pas un refus (personne n'a tranché), aucune tâche
 * (il n'y en a pas). Retourne le nombre de lignes closes et les listes
 * sans les références de propositions, qui ne doivent jamais atteindre
 * `task_sources` ni les clôtures de tâches.
 */
export async function resolvePendingProposals<
  M extends { taskId: string },
  C extends ResolvedTaskCompletion,
>(
  conn: Database,
  lists: { completedTasks: C[]; mentionedTasks: M[] },
  now: Date = new Date(),
): Promise<{ resolved: number; completedTasks: C[]; mentionedTasks: M[] }> {
  const byTable = { email: [] as string[], meeting: [] as string[] };
  for (const c of lists.completedTasks) {
    const ref = parseProposalRef(c.taskId);
    if (ref) byTable[ref.source].push(ref.id);
  }
  if (byTable.email.length > 0) {
    await conn
      .update(emailProposals)
      .set({ status: "expired", decidedAt: now })
      .where(and(inArray(emailProposals.id, byTable.email), eq(emailProposals.status, "pending")));
  }
  if (byTable.meeting.length > 0) {
    await conn
      .update(meetingProposals)
      .set({ status: "expired", decidedAt: now })
      .where(
        and(inArray(meetingProposals.id, byTable.meeting), eq(meetingProposals.status, "pending")),
      );
  }
  const isTask = (id: string) => !id.startsWith(PROPOSAL_REF_PREFIX);
  return {
    resolved: byTable.email.length + byTable.meeting.length,
    completedTasks: lists.completedTasks.filter((c) => isTask(c.taskId)),
    mentionedTasks: lists.mentionedTasks.filter((m) => isTask(m.taskId)),
  };
}

/** Messages rejoués par relève pour revoir les propositions de leur fil : un appel LLM chacun. */
const REQUEUE_PENDING_PER_RUN = 3;

/**
 * Propositions de tâche en attente dans un fil qui a reçu un message plus
 * récent, lu avant que l'extraction ne voie les propositions du fil :
 * personne n'a vérifié si ce message les rendait sans objet. On remet en
 * file le dernier message du fil, en mode passages seuls
 * (`requeuedForPendingProposals`) : il peut clore des propositions, il
 * n'en pose aucune.
 */
export async function requeueThreadsWithPendingProposals(
  conn: Database,
  opts: { userId: string; limit?: number },
): Promise<number> {
  const res = await conn.execute(sql`
    select distinct on (later.thread_id) later.id
    from ${emailProposals} p
    join ${gmailMessages} src on src.id = p.message_id
    join ${gmailMessages} later on later.thread_id = src.thread_id and later.internal_date > src.internal_date
    where p.status = 'pending' and p.kind = 'task'
      and src.user_id = ${opts.userId}
      and later.extraction_status = 'extracted'
      and later.body_text is not null
      and coalesce((later.extraction_meta->>'pendingProposalsSeen')::boolean, false) = false
    order by later.thread_id, later.internal_date desc
    limit ${opts.limit ?? REQUEUE_PENDING_PER_RUN}
  `);
  // postgres-js renvoie un tableau, PGlite un objet `{ rows }`.
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { id: string }[];
  for (const r of rows) {
    await conn
      .update(gmailMessages)
      .set({
        extractionStatus: "pending",
        extractionMeta: sql`coalesce(${gmailMessages.extractionMeta}, '{}'::jsonb) || '{"requeuedForPendingProposals": true}'::jsonb`,
      })
      .where(eq(gmailMessages.id, r.id));
  }
  return rows.length;
}

/**
 * Rattachements de fil à un projet que personne ne peut trancher : aucun
 * projet nommé dans le mail et plus de `maxCandidates` candidats. La règle
 * vaut à l'extraction depuis le 28/10 ; celles d'avant expirent ici.
 */
export async function expireUndecidableProjectLinks(
  conn: Database,
  opts: { userId: string; maxCandidates?: number; now?: Date },
): Promise<number> {
  const max = opts.maxCandidates ?? 5;
  const rows = await conn
    .select({ id: emailProposals.id })
    .from(emailProposals)
    .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
    .where(
      and(
        eq(emailProposals.status, "pending"),
        eq(emailProposals.kind, "project_link"),
        eq(gmailMessages.userId, opts.userId),
        sql`${emailProposals.payload}->>'llmMentionedName' is null`,
        sql`jsonb_array_length(coalesce(${emailProposals.payload}->'candidates', '[]'::jsonb)) > ${max}`,
      ),
    );
  if (rows.length === 0) return 0;
  await conn
    .update(emailProposals)
    .set({ status: "expired", decidedAt: opts.now ?? new Date() })
    .where(
      inArray(
        emailProposals.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.length;
}
