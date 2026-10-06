import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";
import { startOfDay } from "./shared";

/**
 * Requêtes partagées entre plusieurs sections du dashboard. Mémoïsées par
 * requête via React `cache()` : le bandeau KPI et le panneau des tâches
 * ont tous deux besoin des tâches ouvertes et du compteur du jour, mais la
 * base ne doit les calculer qu'une fois par rendu.
 */

/** Tâches ouvertes assignées à l'utilisateur (multi-assignation). */
export const getMyOpenTasks = cache(async (userId: string) => {
  const conn = await db();
  return conn
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        sql`${tasks.status} not in ('done', 'cancelled')`,
        sql`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${userId})`,
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.title));
});

/** Nombre de tâches de l'utilisateur terminées aujourd'hui. */
export const getDoneTodayCount = cache(async (userId: string): Promise<number> => {
  const conn = await db();
  const [row] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        sql`${tasks.status} = 'done'`,
        sql`${tasks.completedAt} >= ${startOfDay().toISOString()}`,
        sql`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${userId})`,
      ),
    );
  return row?.count ?? 0;
});
