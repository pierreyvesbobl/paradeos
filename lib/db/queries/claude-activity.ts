import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { claudeCodeActivity } from "@/db/schema/claude-activity";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { type ClaudeBlock, fetchClaudeBlocks } from "@/lib/time/claude-blocks";
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
  timeEntryId: string | null;
};

const select = {
  id: claudeCodeActivity.id,
  userId: claudeCodeActivity.userId,
  projectId: claudeCodeActivity.projectId,
  remote: claudeCodeActivity.remote,
  startedAt: claudeCodeActivity.startedAt,
  endedAt: claudeCodeActivity.endedAt,
  timeEntryId: claudeCodeActivity.timeEntryId,
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

async function projectNames(conn: Awaited<ReturnType<typeof db>>, ids: readonly string[]) {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const found = await conn
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, [...ids]));
  for (const p of found) names.set(p.id, p.name);
  return names;
}

export type ClaudeActivityRow = {
  projectId: string | null;
  projectName: string | null;
  /** Dépôts observés, utile quand `projectId` est null (non rattaché). */
  remotes: string[];
  /** Segments reçus sur la période. */
  segments: number;
  minutes: number;
  /** Part de `minutes` déjà tranchée en créneau réalisé. */
  imputedMinutes: number;
};

export type ClaudeActivity = {
  totalMinutes: number;
  imputedMinutes: number;
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
  if (rows.length === 0) return { totalMinutes: 0, imputedMinutes: 0, byProject: [], lastAt: null };

  const credits = credit(rows);
  const names = await projectNames(conn, [
    ...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id)),
  ]);

  // Un projet = une ligne ; sans projet, une ligne par dépôt (ou dossier),
  // pour que chaque signal non rattaché reste visible et rattachable.
  const acc = new Map<
    string,
    {
      projectId: string | null;
      minutes: number;
      imputed: number;
      segments: number;
      remotes: Set<string>;
    }
  >();
  let totalMinutes = 0;
  let imputedMinutes = 0;
  let lastAt: Date | null = null;
  for (const r of rows) {
    const minutes = credits.get(r.id) ?? 0;
    totalMinutes += minutes;
    if (r.timeEntryId) imputedMinutes += minutes;
    if (!lastAt || r.endedAt > lastAt) lastAt = r.endedAt;
    const key = r.projectId ?? `remote:${r.remote ?? ""}`;
    const cur = acc.get(key) ?? {
      projectId: r.projectId,
      minutes: 0,
      imputed: 0,
      segments: 0,
      remotes: new Set<string>(),
    };
    cur.minutes += minutes;
    if (r.timeEntryId) cur.imputed += minutes;
    cur.segments += 1;
    if (r.remote) cur.remotes.add(r.remote);
    acc.set(key, cur);
  }

  const byProject = [...acc.values()]
    .map((v) => ({
      projectId: v.projectId,
      projectName: v.projectId ? (names.get(v.projectId) ?? null) : null,
      remotes: [...v.remotes].sort(),
      segments: v.segments,
      minutes: Math.round(v.minutes),
      imputedMinutes: Math.round(v.imputed),
    }))
    .filter((r) => r.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return {
    totalMinutes: Math.round(totalMinutes),
    imputedMinutes: Math.round(imputedMinutes),
    byProject,
    lastAt,
  };
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

export {
  type ClaudeBlock,
  claudeBlockTitle,
  mergeSegmentsIntoBlocks,
} from "@/lib/time/claude-blocks";

/** Blocs non imputés d'un utilisateur dont le début tombe dans [start, end). */
export async function getClaudeBlocksForUser(
  userId: string,
  start: Date,
  end: Date,
): Promise<ClaudeBlock[]> {
  return fetchClaudeBlocks(await db(), userId, start, end);
}
