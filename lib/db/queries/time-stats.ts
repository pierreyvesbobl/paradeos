import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { timeEntries } from "@/db/schema/time-entries";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

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

/** Stats pour une opportunité : totaux du temps avant-vente. */
export async function getOpportunityTimeStats(opportunityId: string): Promise<TimeBreakdown> {
  const conn = await db();
  const [row] = await conn
    .select({
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .where(eq(timeEntries.opportunityId, opportunityId));
  return {
    actualMinutes: row?.actualMinutes ?? 0,
    plannedMinutes: row?.plannedMinutes ?? 0,
  };
}

/** Stats pour un projet : totaux + breakdown par tâche et par utilisateur.
 *
 * Inclut le temps avant-vente : tous les `time_entries` rattachés aux
 * opportunités liées à ce projet (`opportunities.projectId = projectId`).
 * Renvoie aussi le découpage avant-vente / delivery dans `presale`. */
export async function getProjectTimeStats(projectId: string): Promise<{
  totals: TimeBreakdown;
  presale: TimeBreakdown;
  delivery: TimeBreakdown;
  byTask: ByTaskRow[];
  byUser: ByUserRow[];
}> {
  const conn = await db();

  // 1. Trouve les ids d'opportunités converties en ce projet — leur
  //    temps avant-vente sera agrégé.
  const linkedOppRows = await conn
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.projectId, projectId));
  const linkedOppIds = linkedOppRows.map((r) => r.id);

  const projectOnly = eq(timeEntries.projectId, projectId);
  const presaleOnly =
    linkedOppIds.length > 0 ? inArray(timeEntries.opportunityId, linkedOppIds) : undefined;
  const allTimeForProject = presaleOnly ? or(projectOnly, presaleOnly) : projectOnly;

  const [deliveryRow] = await conn
    .select({
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .where(projectOnly);

  const presale: TimeBreakdown = presaleOnly
    ? ((
        await conn
          .select({
            actualMinutes: sumActualMin,
            plannedMinutes: sumPlannedMin,
          })
          .from(timeEntries)
          .where(presaleOnly)
      )[0] ?? { actualMinutes: 0, plannedMinutes: 0 })
    : { actualMinutes: 0, plannedMinutes: 0 };

  const delivery = deliveryRow ?? { actualMinutes: 0, plannedMinutes: 0 };
  const totals: TimeBreakdown = {
    actualMinutes: presale.actualMinutes + delivery.actualMinutes,
    plannedMinutes: presale.plannedMinutes + delivery.plannedMinutes,
  };

  const byTask = await conn
    .select({
      taskId: tasks.id,
      taskTitle: tasks.title,
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .leftJoin(tasks, eq(timeEntries.taskId, tasks.id))
    .where(allTimeForProject)
    .groupBy(tasks.id, tasks.title)
    .orderBy(desc(sumActualMin));

  const byUser = await conn
    .select({
      userId: users.id,
      userName: users.fullName,
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .where(allTimeForProject)
    .groupBy(users.id, users.fullName)
    .orderBy(desc(sumActualMin));

  return {
    totals,
    presale,
    delivery,
    byTask,
    byUser,
  };
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

  const [totalsRow] = await conn
    .select({
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .where(eq(timeEntries.taskId, taskId));

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

  return {
    totals: totalsRow ?? { actualMinutes: 0, plannedMinutes: 0 },
    entries,
  };
}

/** Récap global : breakdown par projet sur une période donnée [start, end). */
export async function getGlobalTimeStats(start: Date, end: Date) {
  const conn = await db();

  const [totalsRow] = await conn
    .select({
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .where(and(gte(timeEntries.startAt, start), lt(timeEntries.startAt, end)));

  const byProject: ByProjectRow[] = await conn
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectKind: projects.kind,
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(gte(timeEntries.startAt, start), lt(timeEntries.startAt, end)))
    .groupBy(projects.id, projects.name, projects.kind)
    .orderBy(desc(sumActualMin));

  const byUser: ByUserRow[] = await conn
    .select({
      userId: users.id,
      userName: users.fullName,
      actualMinutes: sumActualMin,
      plannedMinutes: sumPlannedMin,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .where(and(gte(timeEntries.startAt, start), lt(timeEntries.startAt, end)))
    .groupBy(users.id, users.fullName)
    .orderBy(desc(sumActualMin));

  return {
    totals: totalsRow ?? { actualMinutes: 0, plannedMinutes: 0 },
    byProject,
    byUser,
  };
}
