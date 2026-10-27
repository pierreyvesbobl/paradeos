import "server-only";

import { asc, eq } from "drizzle-orm";
import { gmailMessages } from "@/db/schema/gmail";
import { meetings } from "@/db/schema/meetings";
import { taskSources } from "@/db/schema/task-sources";
import { db } from "@/lib/db/server";

export type TaskSourceExcerpt = {
  quote: string;
  speaker: string | null;
  relation: "origin" | "mention" | "completion";
};

/** Une réunion ou un mail qui a parlé de la tâche, avec ses passages. */
export type TaskSourceGroup = {
  key: string;
  source: "meeting" | "email";
  /** Titre de la réunion ou sujet du mail. */
  label: string;
  href: string;
  /** Date de la source (réunion tenue le, mail reçu le). */
  occurredAt: Date | null;
  /** Expéditeur du mail, pour attribuer les passages sans locuteur. */
  fromName: string | null;
  excerpts: TaskSourceExcerpt[];
};

/**
 * Ce qui a été dit d'une tâche, groupé par source et dans l'ordre
 * chronologique : la plus ancienne d'abord, c'est le fil du besoin tel
 * qu'il s'est précisé.
 */
export async function getTaskSources(taskId: string): Promise<TaskSourceGroup[]> {
  const conn = await db();
  const [meetingRows, emailRows] = await Promise.all([
    conn
      .select({
        id: taskSources.id,
        excerpt: taskSources.excerpt,
        speaker: taskSources.speaker,
        relation: taskSources.relation,
        createdAt: taskSources.createdAt,
        meetingId: meetings.id,
        title: meetings.title,
        occurredAt: meetings.occurredAt,
      })
      .from(taskSources)
      .innerJoin(meetings, eq(meetings.id, taskSources.meetingId))
      .where(eq(taskSources.taskId, taskId))
      .orderBy(asc(meetings.occurredAt), asc(taskSources.createdAt)),
    conn
      .select({
        id: taskSources.id,
        excerpt: taskSources.excerpt,
        speaker: taskSources.speaker,
        relation: taskSources.relation,
        createdAt: taskSources.createdAt,
        threadId: gmailMessages.threadId,
        messageId: gmailMessages.id,
        subject: gmailMessages.subject,
        fromName: gmailMessages.fromName,
        fromEmail: gmailMessages.fromEmail,
        internalDate: gmailMessages.internalDate,
      })
      .from(taskSources)
      .innerJoin(gmailMessages, eq(gmailMessages.id, taskSources.messageId))
      .where(eq(taskSources.taskId, taskId))
      .orderBy(asc(gmailMessages.internalDate), asc(taskSources.createdAt)),
  ]);

  const groups = new Map<string, TaskSourceGroup>();
  const push = (key: string, make: () => TaskSourceGroup, excerpt: TaskSourceExcerpt) => {
    const g = groups.get(key) ?? make();
    g.excerpts.push(excerpt);
    groups.set(key, g);
  };
  for (const r of meetingRows) {
    push(
      `meeting:${r.meetingId}`,
      () => ({
        key: `meeting:${r.meetingId}`,
        source: "meeting",
        label: r.title,
        href: `/meetings/${r.meetingId}`,
        occurredAt: r.occurredAt,
        fromName: null,
        excerpts: [],
      }),
      { quote: r.excerpt, speaker: r.speaker, relation: r.relation },
    );
  }
  for (const r of emailRows) {
    push(
      `email:${r.messageId}`,
      () => ({
        key: `email:${r.messageId}`,
        source: "email",
        label: r.subject?.trim() || "(sans objet)",
        href: `/emails/${r.threadId}`,
        occurredAt: r.internalDate,
        fromName: r.fromName ?? r.fromEmail ?? null,
        excerpts: [],
      }),
      { quote: r.excerpt, speaker: r.speaker, relation: r.relation },
    );
  }
  return [...groups.values()].sort(
    (a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0),
  );
}
