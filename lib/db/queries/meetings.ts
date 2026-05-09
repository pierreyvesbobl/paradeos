import "server-only";

import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { desc, eq, sql } from "drizzle-orm";

/**
 * Liste les meetings rattachés à un projet, avec le compteur de
 * propositions LLM encore en attente (badge sur la fiche projet).
 * Triés par `occurred_at` décroissant (plus récent en premier).
 */
export async function getMeetingsForProject(projectId: string) {
  const conn = await db();
  return conn
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      summary: meetings.summary,
      status: meetings.status,
      sourceLabel: meetings.sourceLabel,
      sourceDriveFileId: meetings.sourceDriveFileId,
      createdAt: meetings.createdAt,
      pendingCount: sql<number>`(
        select count(*)::int from meeting_proposals
        where meeting_proposals.meeting_id = meetings.id
          and meeting_proposals.status = 'pending'
      )`,
    })
    .from(meetings)
    .where(eq(meetings.projectId, projectId))
    .orderBy(desc(meetings.occurredAt), desc(meetings.createdAt));
}
