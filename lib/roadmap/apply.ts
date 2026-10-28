import "server-only";

import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { repoRoadmaps, taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { tasks } from "@/db/schema/tasks";
import {
  flattenItems,
  type Roadmap,
  roadmapFromStored,
  taskStatusForRoadmapStatus,
} from "@/lib/roadmap/roadmap";
import { computeCompletedAt, markTaskDone } from "@/lib/tasks/complete";

type Conn = Pick<Database, "select" | "update" | "insert" | "delete">;

/**
 * Aligne le statut d'une tâche sur celui de son item confirmé. Renvoie
 * vrai si quelque chose a été écrit.
 */
async function applyItemStatus(
  conn: Conn,
  task: { id: string; status: string; completedAt: Date | null },
  itemStatus: string,
): Promise<boolean> {
  const target = taskStatusForRoadmapStatus(itemStatus);
  if (!target || target === task.status) return false;
  if (target === "done") {
    const snap = await markTaskDone(conn, task.id);
    return snap?.changed ?? false;
  }
  await conn
    .update(tasks)
    .set({ status: target, completedAt: computeCompletedAt(target, task.completedAt) })
    .where(eq(tasks.id, task.id));
  return true;
}

/** Les liens confirmés d'un dépôt, appliqués sur un instantané de feuille de route. */
export async function applyRoadmapStatuses(
  conn: Conn,
  remote: string,
  roadmap: Roadmap,
): Promise<number> {
  const statusByItem = new Map(flattenItems(roadmap).map((i) => [i.id, i.status]));
  const rows = await conn
    .select({
      taskId: tasks.id,
      status: tasks.status,
      completedAt: tasks.completedAt,
      itemId: taskRoadmapLinks.itemId,
    })
    .from(taskRoadmapLinks)
    .innerJoin(tasks, eq(taskRoadmapLinks.taskId, tasks.id))
    .where(and(eq(taskRoadmapLinks.remote, remote), eq(taskRoadmapLinks.status, "confirmed")));
  let changed = 0;
  for (const r of rows) {
    const itemStatus = statusByItem.get(r.itemId);
    if (!itemStatus) continue;
    if (
      await applyItemStatus(
        conn,
        { id: r.taskId, status: r.status, completedAt: r.completedAt },
        itemStatus,
      )
    ) {
      changed += 1;
    }
  }
  return changed;
}

/** Après confirmation d'un lien : la tâche prend tout de suite le statut de l'item. */
export async function applyRoadmapStatusToTask(conn: Conn, taskId: string): Promise<boolean> {
  const [link] = await conn
    .select({ remote: taskRoadmapLinks.remote, itemId: taskRoadmapLinks.itemId })
    .from(taskRoadmapLinks)
    .where(and(eq(taskRoadmapLinks.taskId, taskId), eq(taskRoadmapLinks.status, "confirmed")))
    .limit(1);
  if (!link) return false;
  const [snapshot] = await conn
    .select({ content: repoRoadmaps.content })
    .from(repoRoadmaps)
    .where(eq(repoRoadmaps.remote, link.remote))
    .limit(1);
  const roadmap = snapshot ? roadmapFromStored(snapshot.content) : null;
  if (!roadmap) return false;
  const item = flattenItems(roadmap).find((i) => i.id === link.itemId);
  if (!item) return false;
  const [task] = await conn
    .select({ id: tasks.id, status: tasks.status, completedAt: tasks.completedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return false;
  return applyItemStatus(conn, task, item.status);
}
