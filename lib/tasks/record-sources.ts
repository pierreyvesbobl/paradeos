import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { taskSources } from "@/db/schema/task-sources";
import { excerptFingerprint, type TaskExcerpt } from "@/lib/tasks/task-sources";

/**
 * Écriture des sources de tâche (cf. lib/tasks/task-sources.ts pour la
 * partie pure). Une source est une réunion ou un message Gmail.
 */

export type TaskSourceRef = { meetingId: string } | { messageId: string };
export type TaskSourceRelation = "origin" | "mention" | "completion";

type Conn = Pick<Database, "insert" | "delete">;

/**
 * Enregistre des passages pour une tâche. Idempotent : un passage déjà
 * présent pour la même tâche et la même source (empreinte normalisée) est
 * ignoré, quelle que soit sa relation. Renvoie le nombre de lignes posées.
 */
export async function recordTaskSources(
  conn: Conn,
  args: {
    taskId: string;
    source: TaskSourceRef;
    relation: TaskSourceRelation;
    excerpts: readonly TaskExcerpt[];
  },
): Promise<number> {
  if (args.excerpts.length === 0) return 0;
  const base =
    "meetingId" in args.source
      ? { sourceKind: "meeting" as const, meetingId: args.source.meetingId, messageId: null }
      : { sourceKind: "email" as const, meetingId: null, messageId: args.source.messageId };
  const rows = await conn
    .insert(taskSources)
    .values(
      args.excerpts.map((e) => ({
        taskId: args.taskId,
        ...base,
        relation: args.relation,
        excerpt: e.quote,
        speaker: e.speaker,
        excerptFingerprint: excerptFingerprint(e.quote),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: taskSources.id });
  return rows.length;
}

/**
 * Avant de ré-extraire une source : efface ce que l'extraction précédente
 * y avait lu (mentions et clôtures). Les lignes `origin` restent — elles
 * datent de l'acceptation d'une proposition, pas de l'extraction, et la
 * tâche qu'elles documentent existe toujours.
 */
export async function clearExtractedTaskSources(conn: Conn, source: TaskSourceRef): Promise<void> {
  const sourceCond =
    "meetingId" in source
      ? eq(taskSources.meetingId, source.meetingId)
      : eq(taskSources.messageId, source.messageId);
  await conn
    .delete(taskSources)
    .where(and(sourceCond, inArray(taskSources.relation, ["mention", "completion"])));
}
