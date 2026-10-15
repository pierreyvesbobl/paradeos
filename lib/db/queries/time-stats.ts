import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { timeEntries } from "@/db/schema/time-entries";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";

const durationMin = sql<number>`(extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60)::int`;
const sumActualMin = sql<number>`coalesce(sum((extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60))
  filter (where ${timeEntries.kind} = 'actual'), 0)::int`;
const sumPlannedMin = sql<number>`coalesce(sum((extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60))
  filter (where ${timeEntries.kind} = 'planned'), 0)::int`;

export type TimeBreakdown = {
  actualMinutes: number;
  plannedMinutes: number;
};

export type ByTaskRow = TimeBreakdown & {
  taskId: string | null;
  taskTitle: string | null;
};

export type ByUserRow = TimeBreakdown & {
  userId: string;
  userName: string | null;
};

export type ByProjectRow = TimeBreakdown & {
  projectId: string | null;
  projectName: string | null;
  projectKind: string | null;
};

export type TimeSource = "manual" | "calendar" | "claude_code";

/** Minutes réalisées par provenance de saisie. */
export type BySource = Record<TimeSource, number>;

/**
 * Stats pour un projet : totaux + breakdown par tâche et par utilisateur.
 * Avec la fusion opportunities → projects, le temps avant-vente (statuts
 * commerciaux) et delivery sont agrégés sur la même row projet.
 */
export async function getProjectTimeStats(projectId: string): Promise<{
  totals: TimeBreakdown;
  byTask: ByTaskRow[];
  byUser: ByUserRow[];
}> {
  const conn = await db();

  // Les totaux se déduisent du breakdown par user : trois requêtes au
  // lieu de quatre (la page projet est la plus chargée en concurrence).
  const [byTask, byUser] = await Promise.all([
    conn
      .select({
        taskId: tasks.id,
        taskTitle: tasks.title,
        actualMinutes: sumActualMin,
        plannedMinutes: sumPlannedMin,
      })
      .from(timeEntries)
      .leftJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .where(eq(timeEntries.projectId, projectId))
      .groupBy(tasks.id, tasks.title)
      .orderBy(desc(sumActualMin)),
    conn
      .select({
        userId: users.id,
        userName: users.fullName,
        actualMinutes: sumActualMin,
        plannedMinutes: sumPlannedMin,
      })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(eq(timeEntries.projectId, projectId))
      .groupBy(users.id, users.fullName)
      .orderBy(desc(sumActualMin)),
  ]);

  const totals = byUser.reduce<TimeBreakdown>(
    (acc, u) => {
      acc.actualMinutes += u.actualMinutes;
      acc.plannedMinutes += u.plannedMinutes;
      return acc;
    },
    { actualMinutes: 0, plannedMinutes: 0 },
  );
  return { totals, byTask, byUser };
}

/** Stats pour une tâche : totaux + entries détaillées. */
export async function getTaskTimeStats(taskId: string): Promise<{
  totals: TimeBreakdown;
  entries: {
    id: string;
    kind: "planned" | "actual";
    startAt: Date;
    endAt: Date;
    minutes: number;
    title: string | null;
    userName: string | null;
  }[];
}> {
  const conn = await db();

  // Le total se déduit des entrées : une seule requête.
  const entries = await conn
    .select({
      id: timeEntries.id,
      kind: timeEntries.kind,
      startAt: timeEntries.startAt,
      endAt: timeEntries.endAt,
      minutes: durationMin,
      title: timeEntries.title,
      userName: users.fullName,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .where(eq(timeEntries.taskId, taskId))
    .orderBy(desc(timeEntries.startAt));

  const totals = entries.reduce<TimeBreakdown>(
    (acc, e) => {
      if (e.kind === "actual") acc.actualMinutes += e.minutes;
      else acc.plannedMinutes += e.minutes;
      return acc;
    },
    { actualMinutes: 0, plannedMinutes: 0 },
  );
  return { totals, entries };
}

/** Récap global : breakdown par projet sur une période donnée [start, end). */
export async function getGlobalTimeStats(start: Date, end: Date) {
  const conn = await db();
  const inRange = and(gte(timeEntries.startAt, start), lt(timeEntries.startAt, end));

  // Quatre lectures indépendantes sur la même fenêtre : en parallèle.
  const [totalsRows, byProject, byUser, bySourceRows] = await Promise.all([
    conn
      .select({
        actualMinutes: sumActualMin,
        plannedMinutes: sumPlannedMin,
      })
      .from(timeEntries)
      .where(inRange),
    conn
      .select({
        projectId: projects.id,
        projectName: projects.name,
        projectKind: projects.kind,
        actualMinutes: sumActualMin,
        plannedMinutes: sumPlannedMin,
      })
      .from(timeEntries)
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(inRange)
      .groupBy(projects.id, projects.name, projects.kind)
      .orderBy(desc(sumActualMin)),
    conn
      .select({
        userId: users.id,
        userName: users.fullName,
        actualMinutes: sumActualMin,
        plannedMinutes: sumPlannedMin,
      })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(inRange)
      .groupBy(users.id, users.fullName)
      .orderBy(desc(sumActualMin)),
    conn
      .select({ source: timeEntries.source, actualMinutes: sumActualMin })
      .from(timeEntries)
      .where(inRange)
      .groupBy(timeEntries.source),
  ]);

  const totals = totalsRows[0] ?? { actualMinutes: 0, plannedMinutes: 0 };

  const bySource: BySource = { manual: 0, calendar: 0, claude_code: 0 };
  for (const r of bySourceRows) {
    if (r.source in bySource) bySource[r.source as TimeSource] = r.actualMinutes;
  }

  return {
    totals,
    byProject: byProject as ByProjectRow[],
    byUser: byUser as ByUserRow[],
    bySource,
  };
}
