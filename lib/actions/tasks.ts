"use server";

import { tasks } from "@/db/schema/tasks";
import { action } from "@/lib/actions/action";
import { type AssigneeRef, setTaskAssignees } from "@/lib/db/queries/task-assignees";
import { db } from "@/lib/db/server";
import {
  bulkDeleteTaskSchema,
  bulkPatchTaskSchema,
  createTaskSchema,
  deleteTaskSchema,
  patchTaskSchema,
  quickCreateTaskSchema,
  toggleTaskSchema,
  updateTaskSchema,
} from "@/lib/schemas/tasks";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidateTaskPaths(projectId: string | null | undefined) {
  revalidatePath("/taches");
  revalidatePath("/taches/gantt");
  if (projectId) revalidatePath(`/projets/${projectId}`);
}

/**
 * Normalise les entrées legacy (assigneeId | assigneeContactId) vers le
 * format multi `assignees[]`. Si `assignees` est explicitement fourni, on
 * s'en sert tel quel — sinon on dérive de la paire legacy (max 1 entrée
 * puisqu'elle est mono).
 */
function resolveAssignees(input: {
  assignees?: AssigneeRef[];
  assigneeId?: string | null;
  assigneeContactId?: string | null;
}): AssigneeRef[] | undefined {
  if (input.assignees !== undefined) return input.assignees;
  // Compat ascendante : si l'un des deux est posé, on construit la liste.
  // Si les deux sont undefined, on retourne undefined (= "ne pas toucher").
  if (input.assigneeId === undefined && input.assigneeContactId === undefined) {
    return undefined;
  }
  const out: AssigneeRef[] = [];
  if (input.assigneeContactId) out.push({ kind: "contact", id: input.assigneeContactId });
  else if (input.assigneeId) out.push({ kind: "user", id: input.assigneeId });
  return out;
}

export const createTask = action(createTaskSchema, async ({ input, user }) => {
  const conn = await db();
  const completedAt = input.status === "done" ? new Date() : null;
  const desiredAssignees = resolveAssignees(input) ?? [];

  const id = await conn.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        projectId: input.projectId ?? null,
        // Colonnes legacy conservées en NULL — le trigger ne fire pas et
        // la source de vérité est `task_assignees`.
        assigneeId: null,
        assigneeContactId: null,
        dueDate: input.dueDate ?? null,
        startDate: input.startDate ?? null,
        completedAt,
        ownerId: user.id,
        createdBy: user.id,
      })
      .returning({ id: tasks.id });
    if (!row) throw new Error("Échec création tâche.");
    await setTaskAssignees(tx, row.id, desiredAssignees, user.id);
    return row.id;
  });

  revalidateTaskPaths(input.projectId ?? null);
  return { id };
});

/**
 * Création éclair depuis le quick-add. Par défaut : status=todo,
 * priority=medium, assignée à l'auteur. Les contrôles UI peuvent surcharger.
 */
export const quickCreateTask = action(quickCreateTaskSchema, async ({ input, user }) => {
  const conn = await db();
  // Si rien n'est fourni côté assignés, on assigne par défaut à l'auteur
  // (cohérent avec l'ancien comportement). Si un tableau vide est fourni
  // explicitement, on respecte (tâche sans assigné).
  const resolved = resolveAssignees(input);
  const assignees: AssigneeRef[] = resolved ?? [{ kind: "user", id: user.id }];

  const row = await conn.transaction(async (tx) => {
    const [r] = await tx
      .insert(tasks)
      .values({
        title: input.title,
        status: "todo",
        priority: input.priority ?? "medium",
        projectId: input.projectId ?? null,
        assigneeId: null,
        assigneeContactId: null,
        dueDate: input.dueDate ?? null,
        ownerId: user.id,
        createdBy: user.id,
      })
      .returning({ id: tasks.id, title: tasks.title });
    if (!r) throw new Error("Échec création tâche.");
    await setTaskAssignees(tx, r.id, assignees, user.id);
    return r;
  });

  revalidateTaskPaths(input.projectId ?? null);
  return row;
});

export const updateTask = action(updateTaskSchema, async ({ input, user }) => {
  const conn = await db();

  const [previous] = await conn
    .select({ status: tasks.status, completedAt: tasks.completedAt, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, input.id))
    .limit(1);

  const completedAt = computeCompletedAt(input.status, previous?.completedAt);
  const desiredAssignees = resolveAssignees(input) ?? [];

  await conn.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        projectId: input.projectId ?? null,
        assigneeId: null,
        assigneeContactId: null,
        dueDate: input.dueDate ?? null,
        startDate: input.startDate ?? null,
        completedAt,
      })
      .where(eq(tasks.id, input.id));
    await setTaskAssignees(tx, input.id, desiredAssignees, user.id);
  });

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

  // Les rows task_assignees sont CASCADE-dropped par la FK.
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
 * Patch partiel depuis les éditeurs inline. Seuls les champs présents
 * sont écrits. Si `assignees` est fourni (ou compat `assigneeId` /
 * `assigneeContactId`), on remplace l'ensemble des assignés en
 * delete-and-replace. Sinon on laisse `task_assignees` intact.
 */
export const patchTask = action(patchTaskSchema, async ({ input, user }) => {
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
  if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
  if (input.startDate !== undefined) updates.startDate = input.startDate;
  if (input.status !== undefined) {
    updates.status = input.status;
    updates.completedAt = computeCompletedAt(input.status, previous.completedAt);
  }

  const desiredAssignees = resolveAssignees(input);

  await conn.transaction(async (tx) => {
    if (Object.keys(updates).length > 0) {
      await tx.update(tasks).set(updates).where(eq(tasks.id, input.id));
    }
    if (desiredAssignees !== undefined) {
      await setTaskAssignees(tx, input.id, desiredAssignees, user.id);
    }
  });

  revalidatePath(`/taches/${input.id}`);
  revalidateTaskPaths(previous.projectId);
  if (input.projectId !== undefined && input.projectId !== previous.projectId) {
    revalidateTaskPaths(input.projectId);
  }
  return { id: input.id };
});

/**
 * Mise à jour en masse depuis la barre d'actions flottante. Champs non
 * relationnels en 1 UPDATE ; assignés répliqués via le helper si fournis
 * (N transactions séquentielles — borné à 500 ids).
 */
export const bulkPatchTasks = action(bulkPatchTaskSchema, async ({ input, user }) => {
  const conn = await db();
  const updates: Partial<typeof tasks.$inferInsert> = {};
  const { patch } = input;

  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.dueDate !== undefined) updates.dueDate = patch.dueDate;
  if (patch.status !== undefined) {
    updates.status = patch.status;
    updates.completedAt = patch.status === "done" ? new Date() : null;
  }

  const desiredAssignees = resolveAssignees(patch);

  const touched = await conn.transaction(async (tx) => {
    let updated: { id: string; projectId: string | null }[] = [];
    if (Object.keys(updates).length > 0) {
      updated = await tx
        .update(tasks)
        .set(updates)
        .where(inArray(tasks.id, input.ids))
        .returning({ id: tasks.id, projectId: tasks.projectId });
    } else {
      updated = await tx
        .select({ id: tasks.id, projectId: tasks.projectId })
        .from(tasks)
        .where(inArray(tasks.id, input.ids));
    }
    if (desiredAssignees !== undefined) {
      for (const t of updated) {
        await setTaskAssignees(tx, t.id, desiredAssignees, user.id);
      }
    }
    return updated;
  });

  const projectIds = new Set<string>();
  for (const t of touched) {
    if (t.projectId) projectIds.add(t.projectId);
  }
  revalidatePath("/taches");
  revalidatePath("/taches/gantt");
  for (const pid of projectIds) revalidatePath(`/projets/${pid}`);

  return { count: touched.length };
});

/**
 * Suppression en masse depuis la barre flottante. Les jointures
 * task_assignees cascadent (FK ON DELETE CASCADE).
 */
export const bulkDeleteTasks = action(bulkDeleteTaskSchema, async ({ input }) => {
  const conn = await db();
  const touched = await conn
    .delete(tasks)
    .where(inArray(tasks.id, input.ids))
    .returning({ id: tasks.id, projectId: tasks.projectId });

  const projectIds = new Set<string>();
  for (const t of touched) {
    if (t.projectId) projectIds.add(t.projectId);
  }
  revalidatePath("/taches");
  revalidatePath("/taches/gantt");
  for (const pid of projectIds) revalidatePath(`/projets/${pid}`);

  return { count: touched.length };
});
