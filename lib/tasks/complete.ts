import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { type Task, tasks } from "@/db/schema/tasks";

/**
 * Passage d'une tâche en `done` et retour arrière, partagés entre les
 * Server Actions, le serveur MCP et les extractions (mail, réunion) qui
 * clôturent une tâche d'après ce qu'elles lisent.
 *
 * Pas de `server-only` ici : le serveur MCP stdio tourne sous tsx et ne
 * charge pas ce module. La connexion est injectée pour la même raison.
 */

/** Connexion top-level ou transaction Drizzle : même API select / update. */
type DbOrTx = Pick<Database, "select" | "update">;

export type TaskStatus = Task["status"];

export type TaskCompletionSnapshot = {
  /** Statut avant le passage en `done`. */
  previousStatus: TaskStatus;
  /** `completed_at` avant l'écriture (une tâche rouverte peut en garder un). */
  previousCompletedAt: Date | null;
  /** Faux si la tâche était déjà `done` : rien n'a été écrit. */
  changed: boolean;
};

/**
 * `completed_at` à poser pour un statut cible : on conserve la date déjà
 * connue (saisie rétroactive) tant que la tâche reste terminée.
 */
export function computeCompletedAt(
  nextStatus: string,
  previousCompletedAt: Date | null | undefined,
): Date | null {
  if (nextStatus === "done") {
    return previousCompletedAt ?? new Date();
  }
  return null;
}

/**
 * Passe la tâche en `done`. Idempotent : une tâche déjà terminée n'est pas
 * réécrite (son `completed_at` d'origine est conservé). Renvoie l'état
 * précédent pour pouvoir le restaurer, ou `null` si la tâche n'existe pas.
 */
export async function markTaskDone(
  conn: DbOrTx,
  taskId: string,
): Promise<TaskCompletionSnapshot | null> {
  const [current] = await conn
    .select({ status: tasks.status, completedAt: tasks.completedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!current) return null;

  const snapshot: TaskCompletionSnapshot = {
    previousStatus: current.status,
    previousCompletedAt: current.completedAt ?? null,
    changed: current.status !== "done",
  };
  if (!snapshot.changed) return snapshot;

  await conn
    .update(tasks)
    .set({ status: "done", completedAt: computeCompletedAt("done", current.completedAt) })
    .where(eq(tasks.id, taskId));
  return snapshot;
}

/**
 * Annule un passage en `done` : restaure le statut et le `completed_at`
 * d'avant. Ne touche à rien si la tâche n'est plus `done` (quelqu'un l'a
 * déjà rouverte ou modifiée depuis) — renvoie alors `false`.
 */
export async function restoreTaskStatus(
  conn: DbOrTx,
  taskId: string,
  previous: { status: TaskStatus; completedAt: Date | null },
): Promise<boolean> {
  const status = previous.status === "done" ? "todo" : previous.status;
  const restored = await conn
    .update(tasks)
    .set({ status, completedAt: computeCompletedAt(status, previous.completedAt) })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "done")))
    .returning({ id: tasks.id });
  return restored.length > 0;
}
