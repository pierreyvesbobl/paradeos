"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { projectRepos } from "@/db/schema/project-repos";
import { taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { tasks } from "@/db/schema/tasks";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { applyRoadmapStatusToTask, syncRoadmaps } from "@/lib/roadmap/sync";
import {
  decideRoadmapLinkSchema,
  linkTaskToRoadmapItemSchema,
  setProjectRepoRoadmapPathSchema,
  syncProjectRoadmapsSchema,
  unlinkRoadmapTaskSchema,
} from "@/lib/schemas/roadmap";

async function projectOfTask(taskId: string): Promise<string | null> {
  const conn = await db();
  const [row] = await conn
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.projectId ?? null;
}

function revalidateTask(taskId: string, projectId: string | null) {
  revalidatePath(`/taches/${taskId}`);
  if (projectId) revalidatePath(`/projets/${projectId}`);
}

/**
 * Tranche une suggestion. Confirmer retire les autres liens confirmés de
 * la tâche (une tâche n'en a qu'un) et aligne tout de suite son statut sur
 * l'item. Refuser garde la paire pour ne plus la reproposer.
 */
export const decideRoadmapLink = action(decideRoadmapLinkSchema, async ({ input }) => {
  const conn = await db();
  const [link] = await conn
    .select({ taskId: taskRoadmapLinks.taskId, status: taskRoadmapLinks.status })
    .from(taskRoadmapLinks)
    .where(eq(taskRoadmapLinks.id, input.id))
    .limit(1);
  if (!link) throw new Error("Suggestion introuvable.");

  if (input.decision === "confirm") {
    await conn
      .delete(taskRoadmapLinks)
      .where(
        and(
          eq(taskRoadmapLinks.taskId, link.taskId),
          eq(taskRoadmapLinks.status, "confirmed"),
          ne(taskRoadmapLinks.id, input.id),
        ),
      );
  }
  await conn
    .update(taskRoadmapLinks)
    .set({
      status: input.decision === "confirm" ? "confirmed" : "rejected",
      decidedAt: new Date(),
    })
    .where(eq(taskRoadmapLinks.id, input.id));

  let statusChanged = false;
  if (input.decision === "confirm") {
    statusChanged = await applyRoadmapStatusToTask(conn, link.taskId);
  }
  revalidateTask(link.taskId, await projectOfTask(link.taskId));
  return { taskId: link.taskId, statusChanged };
});

/** Liaison manuelle d'une tâche à un item : confirmée d'emblée. */
export const linkTaskToRoadmapItem = action(linkTaskToRoadmapItemSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .delete(taskRoadmapLinks)
    .where(
      and(eq(taskRoadmapLinks.taskId, input.taskId), eq(taskRoadmapLinks.status, "confirmed")),
    );
  await conn
    .insert(taskRoadmapLinks)
    .values({
      taskId: input.taskId,
      remote: input.remote,
      itemId: input.itemId,
      status: "confirmed",
      decidedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [taskRoadmapLinks.taskId, taskRoadmapLinks.remote, taskRoadmapLinks.itemId],
      set: { status: "confirmed", decidedAt: new Date() },
    });
  const statusChanged = await applyRoadmapStatusToTask(conn, input.taskId);
  revalidateTask(input.taskId, await projectOfTask(input.taskId));
  return { statusChanged };
});

/** Retire le lien confirmé d'une tâche ; son statut n'est plus piloté. */
export const unlinkRoadmapTask = action(unlinkRoadmapTaskSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .delete(taskRoadmapLinks)
    .where(
      and(eq(taskRoadmapLinks.taskId, input.taskId), eq(taskRoadmapLinks.status, "confirmed")),
    );
  revalidateTask(input.taskId, await projectOfTask(input.taskId));
  return { taskId: input.taskId };
});

/** Relit les feuilles de route du projet et applique tout de suite. */
export const syncProjectRoadmaps = action(syncProjectRoadmapsSchema, async ({ input }) => {
  const conn = await db();
  const results = await syncRoadmaps(conn, input.projectId);
  revalidatePath(`/projets/${input.projectId}`);
  return results;
});

/** Chemin du roadmap.json sur un dépôt (vide = plus suivi). */
export const setProjectRepoRoadmapPath = action(
  setProjectRepoRoadmapPathSchema,
  async ({ input }) => {
    const conn = await db();
    const [row] = await conn
      .update(projectRepos)
      .set({ roadmapPath: input.roadmapPath ? input.roadmapPath : null })
      .where(eq(projectRepos.id, input.id))
      .returning({ projectId: projectRepos.projectId, roadmapPath: projectRepos.roadmapPath });
    if (!row) throw new Error("Dépôt introuvable.");
    if (row.roadmapPath) await syncRoadmaps(conn, row.projectId);
    revalidatePath(`/projets/${row.projectId}`);
    return row;
  },
);
