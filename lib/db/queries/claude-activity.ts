import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { claudeCodeActivity } from "@/db/schema/claude-activity";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { creditOverlaps } from "@/lib/time/overlap";

/**
 * Signal d'activité Claude Code : combien de temps l'attention est allée
 * sur chaque projet. Ce n'est pas du temps réalisé — rien ici n'entre dans
 * les agrégats de `time-stats.ts`. L'humain s'en sert pour imputer.
 *
 * Deux sessions ouvertes en parallèle écrivent deux segments qui se
 * recouvrent : chaque minute commune est partagée à parts égales entre
 * elles (cf. lib/time/overlap.ts), donc une heure d'horloge reste une
 * heure même répartie sur deux projets. Le partage ne se calcule qu'au
 * sein d'un même utilisateur.
 */
type Row = {
  id: string;
  userId: string;
  projectId: string | null;
  remote: string | null;
  startedAt: Date;
  endedAt: Date;
};

const select = {
  id: claudeCodeActivity.id,
  userId: claudeCodeActivity.userId,
  projectId: claudeCodeActivity.projectId,
  remote: claudeCodeActivity.remote,
  startedAt: claudeCodeActivity.startedAt,
  endedAt: claudeCodeActivity.endedAt,
};

/** Minutes créditées par segment, recouvrements partagés par utilisateur. */
function credit(rows: readonly Row[]): Map<string, number> {
  const out = new Map<string, number>();
  const perUser = new Map<string, Row[]>();
  for (const r of rows) {
    const list = perUser.get(r.userId) ?? [];
    list.push(r);
    perUser.set(r.userId, list);
  }
  for (const list of perUser.values()) {
    const credits = creditOverlaps(
      list.map((r) => ({ id: r.id, startMs: r.startedAt.getTime(), endMs: r.endedAt.getTime() })),
    );
    for (const [id, minutes] of credits) out.set(id, minutes);
  }
  return out;
}

export type ClaudeActivityRow = {
  projectId: string | null;
  projectName: string | null;
  /** Dépôts observés, utile quand `projectId` est null (non rattaché). */
  remotes: string[];
  minutes: number;
};

export type ClaudeActivity = {
  totalMinutes: number;
  byProject: ClaudeActivityRow[];
  /** Dernier segment vu sur la période, pour dire si le signal est frais. */
  lastAt: Date | null;
};

/** Activité sur une période [start, end), agrégée par projet. */
export async function getClaudeActivity(start: Date, end: Date): Promise<ClaudeActivity> {
  const conn = await db();
  const rows = await conn
    .select(select)
    .from(claudeCodeActivity)
    .where(and(gte(claudeCodeActivity.startedAt, start), lt(claudeCodeActivity.startedAt, end)));
  if (rows.length === 0) return { totalMinutes: 0, byProject: [], lastAt: null };

  const credits = credit(rows);
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (projectIds.length > 0) {
    const found = await conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, projectIds));
    for (const p of found) names.set(p.id, p.name);
  }

  const acc = new Map<string | null, { minutes: number; remotes: Set<string> }>();
  let totalMinutes = 0;
  let lastAt: Date | null = null;
  for (const r of rows) {
    const minutes = credits.get(r.id) ?? 0;
    totalMinutes += minutes;
    if (!lastAt || r.endedAt > lastAt) lastAt = r.endedAt;
    const cur = acc.get(r.projectId) ?? { minutes: 0, remotes: new Set<string>() };
    cur.minutes += minutes;
    if (r.remote) cur.remotes.add(r.remote);
    acc.set(r.projectId, cur);
  }

  const byProject = [...acc.entries()]
    .map(([projectId, v]) => ({
      projectId,
      projectName: projectId ? (names.get(projectId) ?? null) : null,
      remotes: [...v.remotes].sort(),
      minutes: Math.round(v.minutes),
    }))
    .filter((r) => r.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return { totalMinutes: Math.round(totalMinutes), byProject, lastAt };
}

/**
 * Minutes créditées à un projet. Les recouvrements se calculent avec les
 * segments des mêmes utilisateurs sur la même fenêtre, y compris ceux
 * d'autres projets — sinon une session parallèle serait comptée deux fois.
 */
export async function getProjectClaudeActivity(projectId: string): Promise<number> {
  const conn = await db();
  const own = await conn
    .select(select)
    .from(claudeCodeActivity)
    .where(eq(claudeCodeActivity.projectId, projectId));
  if (own.length === 0) return 0;

  const userIds = [...new Set(own.map((r) => r.userId))];
  const from = new Date(Math.min(...own.map((r) => r.startedAt.getTime())));
  const to = new Date(Math.max(...own.map((r) => r.endedAt.getTime())));
  const others = await conn
    .select(select)
    .from(claudeCodeActivity)
    .where(
      and(
        inArray(claudeCodeActivity.userId, userIds),
        lte(claudeCodeActivity.startedAt, to),
        gte(claudeCodeActivity.endedAt, from),
        sql`${claudeCodeActivity.projectId} is distinct from ${projectId}`,
      ),
    );

  const credits = credit([...own, ...others]);
  let minutes = 0;
  for (const r of own) minutes += credits.get(r.id) ?? 0;
  return Math.round(minutes);
}
