import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { emailProposals, gmailMessages } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";

export type TaskCompletionSource = {
  source: "meeting" | "email";
  /** Titre de la réunion ou sujet du mail. */
  label: string;
  href: string;
  evidence: string | null;
  decidedAt: Date | null;
  /** Clôturée sans clic humain (réglage TASK_AUTOCOMPLETE_ENABLED). */
  auto: boolean;
  decidedByName: string | null;
};

/**
 * D'où vient la clôture d'une tâche : les propositions `task_completion`
 * acceptées qui la visent, réunions et mails confondus, la plus récente
 * d'abord. Vide pour une tâche fermée à la main.
 */
export async function getTaskCompletionSources(taskId: string): Promise<TaskCompletionSource[]> {
  const conn = await db();
  const [meetingRows, emailRows] = await Promise.all([
    conn
      .select({
        payload: meetingProposals.payload,
        decidedAt: meetingProposals.decidedAt,
        decidedByName: users.fullName,
        meetingId: meetings.id,
        title: meetings.title,
      })
      .from(meetingProposals)
      .innerJoin(meetings, eq(meetings.id, meetingProposals.meetingId))
      .leftJoin(users, eq(users.id, meetingProposals.decidedBy))
      .where(
        and(
          eq(meetingProposals.kind, "task_completion"),
          eq(meetingProposals.status, "accepted"),
          eq(meetingProposals.createdEntityId, taskId),
        ),
      )
      .orderBy(desc(meetingProposals.decidedAt)),
    conn
      .select({
        payload: emailProposals.payload,
        decidedAt: emailProposals.decidedAt,
        decidedByName: users.fullName,
        threadId: gmailMessages.threadId,
        subject: gmailMessages.subject,
      })
      .from(emailProposals)
      .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
      .leftJoin(users, eq(users.id, emailProposals.decidedBy))
      .where(
        and(
          eq(emailProposals.kind, "task_completion"),
          eq(emailProposals.status, "accepted"),
          eq(emailProposals.createdEntityId, taskId),
        ),
      )
      .orderBy(desc(emailProposals.decidedAt)),
  ]);

  const read = (payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    return {
      evidence: typeof p.evidence === "string" && p.evidence.trim() ? p.evidence.trim() : null,
      auto: p.auto === true,
    };
  };

  return [
    ...meetingRows.map(
      (r): TaskCompletionSource => ({
        source: "meeting",
        label: r.title,
        href: `/meetings/${r.meetingId}`,
        decidedAt: r.decidedAt,
        decidedByName: r.decidedByName ?? null,
        ...read(r.payload),
      }),
    ),
    ...emailRows.map(
      (r): TaskCompletionSource => ({
        source: "email",
        label: r.subject?.trim() || "(sans objet)",
        href: `/emails/${r.threadId}`,
        decidedAt: r.decidedAt,
        decidedByName: r.decidedByName ?? null,
        ...read(r.payload),
      }),
    ),
  ].sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0));
}
