"use server";

import { tasks } from "@/db/schema/tasks";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createTaskSchema,
  deleteTaskSchema,
  patchTaskSchema,
  quickCreateTaskSchema,
  toggleTaskSchema,
  updateTaskSchema,
} from "@/lib/schemas/tasks";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidateTaskPaths(projectId: string | null | undefined) {
  revalidatePath("/taches");
  revalidatePath("/taches/gantt");
  if (projectId) revalidatePath(`/projets/${projectId}`);
}

export const createTask = action(createTaskSchema, async ({ input, user }) => {
  const conn = await db();
  const completedAt = input.status === "done" ? new Date() : null;

  const [row] = await conn
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      projectId: input.projectId ?? null,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      completedAt,
      ownerId: user.id,
      createdBy: user.id,
    })
    .returning({ id: tasks.id });

  revalidateTaskPaths(input.projectId ?? null);
  return { id: row?.id };
});

/**
 * Création éclair d'une tâche depuis un input inline (style Notion).
 * Defaults : status=todo, priority=medium, assignée à l'utilisateur courant.
 */
export const quickCreateTask = action(quickCreateTaskSchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(tasks)
    .values({
      title: input.title,
      status: "todo",
      priority: "medium",
      projectId: input.projectId ?? null,
      assigneeId: user.id,
      ownerId: user.id,
      createdBy: user.id,
    })
    .returning({ id: tasks.id, title: tasks.title });

  revalidateTaskPaths(input.projectId ?? null);
  return row ?? null;
});

export const updateTask = action(updateTaskSchema, async ({ input }) => {
  const conn = await db();

  const [previous] = await conn
    .select({ status: tasks.status, completedAt: tasks.completedAt, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, input.id))
    .limit(1);

  const completedAt = computeCompletedAt(input.status, previous?.completedAt);

  await conn
    .update(tasks)
    .set({
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      projectId: input.projectId ?? null,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      completedAt,
    })
    .where(eq(tasks.id, input.id));

  revalidatePath(`/taches/${input.id}`);
  revalidateTaskPaths(input.projectId ?? previous?.projectId ?? null);
  return { id: input.id };
});

export const deleteTask = action(deleteTaskSchema, async ({ input }) => {
  const conn = await db();
  const [previous] = await conn
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, input.id))
    .limit(1);

  await conn.delete(tasks).where(eq(tasks.id, input.id));
  revalidateTaskPaths(previous?.projectId ?? null);
  return { id: input.id };
});

export async function deleteTaskAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteTask({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/taches");
}

/**
 * Bascule le statut entre `todo` et `done` (utile pour la checkbox de
 * complétion dans les listes). Pose ou retire `completed_at`.
 */
export const toggleTask = action(toggleTaskSchema, async ({ input }) => {
  const conn = await db();

  const [current] = await conn
    .select({ status: tasks.status, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, input.id))
    .limit(1);

  if (!current) throw new Error("Tâche introuvable.");

  const nextStatus = current.status === "done" ? "todo" : "done";
  const completedAt = nextStatus === "done" ? sql`now()` : null;

  await conn.update(tasks).set({ status: nextStatus, completedAt }).where(eq(tasks.id, input.id));

  revalidateTaskPaths(current.projectId);
  return { status: nextStatus };
});

function computeCompletedAt(
  nextStatus: string,
  previousCompletedAt: Date | null | undefined,
): Date | null {
  if (nextStatus === "done") {
    return previousCompletedAt ?? new Date();
  }
  return null;
}

/**
 * Patch partiel d'une tâche depuis un éditeur inline (un seul champ à la fois,
 * généralement). Seuls les champs présents dans `input` sont mis à jour.
 */
export const patchTask = action(patchTaskSchema, async ({ input }) => {
  const conn = await db();

  const [previous] = await conn
    .select({
      status: tasks.status,
      completedAt: tasks.completedAt,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(eq(tasks.id, input.id))
    .limit(1);

  if (!previous) throw new Error("Tâche introuvable.");

  const updates: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.projectId !== undefined) updates.projectId = input.projectId;
  if (input.assigneeId !== undefined) updates.assigneeId = input.assigneeId;
  if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
  if (input.startDate !== undefined) updates.startDate = input.startDate;
  if (input.status !== undefined) {
    updates.status = input.status;
    updates.completedAt = computeCompletedAt(input.status, previous.completedAt);
  }

  await conn.update(tasks).set(updates).where(eq(tasks.id, input.id));

  revalidatePath(`/taches/${input.id}`);
  revalidateTaskPaths(previous.projectId);
  if (input.projectId !== undefined && input.projectId !== previous.projectId) {
    revalidateTaskPaths(input.projectId);
  }
  return { id: input.id };
});
