import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { timeEntries } from "@/db/schema/time-entries";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { creditOverlaps, rawMinutes } from "@/lib/time/overlap";

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

/** Minutes réalisées par provenance, après partage des chevauchements Claude Code. */
export type BySource = Record<TimeSource, number>;

type ClaudeRow = {
  id: string;
  userId: string;
  projectId: string | null;
  startAt: Date;
  endAt: Date;
};

/**
 * Deux sessions Claude Code en parallèle écrivent deux segments qui se
 * recouvrent ; une minute ne compte qu'une fois, partagée entre elles.
 * Les agrégats SQL additionnent les segments bruts : on calcule ici, par
 * utilisateur, l'écart entre minutes brutes et minutes créditées, à
 * retrancher ensuite des totaux. `scope` restreint les lignes dont on
 * retient l'écart (la fiche projet ne corrige que ses propres segments,
 * mais les recouvrements se calculent avec ceux des autres projets).
 */
function claudeDeltas(rows: ClaudeRow[], scope?: (r: ClaudeRow) => boolean) {
  const byProject = new Map<string | null, number>();
  const byUser = new Map<string, number>();
  let total = 0;
  let credited = 0;

  const perUser = new Map<string, ClaudeRow[]>();
  for (const r of rows) {
    const list = perUser.get(r.userId) ?? [];
    list.push(r);
    perUser.set(r.userId, list);
  }
  for (const [userId, list] of perUser) {
    const credits = creditOverlaps(
      list.map((r) => ({ id: r.id, startMs: r.startAt.getTime(), endMs: r.endAt.getTime() })),
    );
    for (const r of list) {
      if (scope && !scope(r)) continue;
      const raw = rawMinutes({ id: r.id, startMs: r.startAt.getTime(), endMs: r.endAt.getTime() });
      const got = credits.get(r.id) ?? raw;
      const delta = got - raw;
      credited += got;
      total += delta;
      byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + delta);
      byUser.set(userId, (byUser.get(userId) ?? 0) + delta);
    }
  }
  return { byProject, byUser, total, credited };
}

const claudeSelect = {
  id: timeEntries.id,
  userId: timeEntries.userId,
  projectId: timeEntries.projectId,
  startAt: timeEntries.startAt,
  endAt: timeEntries.endAt,
};

/**
 * Stats pour un projet : totaux + breakdown par tâche et par utilisateur.
 * Avec la fusion opportunities → projects, le temps avant-vente (statuts
 * commerciaux) et delivery sont agrégés sur la même row projet.
 */
export async function getProjectTimeStats(projectId: string): Promise<{
  totals: TimeBreakdown;
  byTask: ByTaskRow[];
  byUser: ByUserRow[];
  /** Minutes réalisées venues de Claude Code, après partage des chevauchements. */
  claudeMinutes: number;
}> {
  const conn = await db();

  // Les totaux se déduisent du breakdown par user : trois requêtes au
  // lieu de quatre (la page projet est la plus chargée en concurrence).
  const [byTask, byUser, claudeRows] = await Promise.all([
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
    conn
      .select(claudeSelect)
      .from(timeEntries)
      .where(and(eq(timeEntries.projectId, projectId), eq(timeEntries.source, "claude_code"))),
  ]);

  const deltas = await projectClaudeDeltas(conn, projectId, claudeRows);
  for (const u of byUser) u.actualMinutes += Math.round(deltas.byUser.get(u.userId) ?? 0);
  const nullTask = byTask.find((t) => t.taskId === null);
  if (nullTask) nullTask.actualMinutes += Math.round(deltas.total);

  const totals = byUser.reduce<TimeBreakdown>(
    (acc, u) => {
      acc.actualMinutes += u.actualMinutes;
      acc.plannedMinutes += u.plannedMinutes;
      return acc;
    },
    { actualMinutes: 0, plannedMinutes: 0 },
  );
  return { totals, byTask, byUser, claudeMinutes: Math.round(deltas.credited) };
}

/**
 * Les segments Claude Code d'un projet peuvent chevaucher ceux d'autres
 * projets (deux sessions ouvertes) : on charge les segments des mêmes
 * utilisateurs sur la même fenêtre pour partager correctement.
 */
async function projectClaudeDeltas(conn: Database, projectId: string, own: ClaudeRow[]) {
  if (own.length === 0) return claudeDeltas([]);
  const userIds = [...new Set(own.map((r) => r.userId))];
  const from = new Date(Math.min(...own.map((r) => r.startAt.getTime())));
  const to = new Date(Math.max(...own.map((r) => r.endAt.getTime())));
  const others = await conn
    .select(claudeSelect)
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.source, "claude_code"),
        inArray(timeEntries.userId, userIds),
        lte(timeEntries.startAt, to),
        gte(timeEntries.endAt, from),
        sql`${timeEntries.projectId} is distinct from ${projectId}`,
      ),
    );
  return claudeDeltas([...own, ...others], (r) => r.projectId === projectId);
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
  const [totalsRows, byProject, byUser, bySourceRows, claudeRows] = await Promise.all([
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
    conn
      .select(claudeSelect)
      .from(timeEntries)
      .where(and(inRange, eq(timeEntries.source, "claude_code"))),
  ]);

  const deltas = claudeDeltas(claudeRows);
  const totals = totalsRows[0] ?? { actualMinutes: 0, plannedMinutes: 0 };
  totals.actualMinutes += Math.round(deltas.total);
  for (const p of byProject) p.actualMinutes += Math.round(deltas.byProject.get(p.projectId) ?? 0);
  for (const u of byUser) u.actualMinutes += Math.round(deltas.byUser.get(u.userId) ?? 0);

  const bySource: BySource = { manual: 0, calendar: 0, claude_code: 0 };
  for (const r of bySourceRows) bySource[r.source] = r.actualMinutes;
  bySource.claude_code = Math.round(deltas.credited);

  return {
    totals,
    byProject: byProject as ByProjectRow[],
    byUser: byUser as ByUserRow[],
    bySource,
  };
}
