import "server-only";

import { meetingProposals, meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import {
  extractMeeting,
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  fuzzyMatchUser,
} from "@/lib/meetings/extract";
import { eq } from "drizzle-orm";

/**
 * Helper coeur du pipeline d'extraction : prend un meetingId, lit son
 * transcript, appelle le LLM, persiste les propositions (avec fuzzy
 * matching FK), met à jour le meeting (summary + status="extracted").
 *
 * Extrait de l'action `extractMeetingProposals` pour pouvoir être
 * appelé sans contexte user (cron Drive sync).
 *
 * Stratégie idempotence : on supprime les propositions précédentes
 * du meeting et on ré-injecte. Si tu veux préserver les `accepted`/
 * `rejected`, ne re-extrait pas un meeting déjà traité.
 */
export async function extractAndSaveProposals(meetingId: string): Promise<{ count: number }> {
  const conn = await db();
  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  const result = await extractMeeting(meeting.transcript);

  await conn.delete(meetingProposals).where(eq(meetingProposals.meetingId, meeting.id));

  const proposalsRows: {
    meetingId: string;
    kind: "task" | "project" | "opportunity" | "contact" | "entity";
    payload: unknown;
    matchedId: string | null;
    matchConfidence: string | null;
  }[] = [];

  for (const e of result.proposedEntities) {
    const match = await fuzzyMatchEntity(e.name);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "entity",
      payload: e,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const c of result.proposedContacts) {
    const match = await fuzzyMatchContact(c.firstName, c.lastName);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "contact",
      payload: c,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const p of result.proposedProjects) {
    const match = await fuzzyMatchProject(p.name);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "project",
      payload: p,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const t of result.proposedTasks) {
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    const assigneeMatch = t.assigneeName ? await fuzzyMatchUser(t.assigneeName) : null;
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "task",
      payload: {
        ...t,
        projectId: projectMatch?.id ?? null,
        assigneeId: assigneeMatch?.id ?? null,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }

  if (proposalsRows.length > 0) {
    await conn.insert(meetingProposals).values(proposalsRows);
  }

  await conn
    .update(meetings)
    .set({
      summary: result.summary,
      occurredAt: meeting.occurredAt ?? (result.occurredAt ? new Date(result.occurredAt) : null),
      status: "extracted",
    })
    .where(eq(meetings.id, meeting.id));

  return { count: proposalsRows.length };
}
