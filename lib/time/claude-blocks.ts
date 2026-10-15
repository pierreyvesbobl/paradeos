import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Database } from "@/db/client";
import { claudeCodeActivity } from "@/db/schema/claude-activity";
import { projects } from "@/db/schema/projects";
import { gitRemoteBasename, repoKeyLabel } from "@/lib/git/remote";

/**
 * Blocs d'activité Claude Code « à imputer », partagés entre la grille de
 * /temps (Server Components) et le serveur MCP (`list_claude_activity`,
 * `log_time`). Prend l'une ou l'autre connexion Drizzle, comme
 * lib/repos/link.ts.
 *
 * Le mod découpe en segments courts (plafond par tour, reprise après
 * pause) ; pour l'humain, une séance de travail est un seul bloc : des
 * segments contigus d'un même utilisateur sur le même projet (ou, sans
 * projet, le même dépôt), fusionnés quand le silence entre deux ne
 * dépasse pas `BLOCK_GAP_MS`. Seuls les segments non encore imputés
 * (`timeEntryId` null) entrent ici.
 */
export type ClaudeSegment = {
  id: string;
  userId: string;
  projectId: string | null;
  remote: string | null;
  startedAt: Date;
  endedAt: Date;
  sourceRef: string;
};

export type ClaudeBlock = {
  /** Id du premier segment : stable, sert de clé React. */
  id: string;
  segmentIds: string[];
  projectId: string | null;
  projectName: string | null;
  remote: string | null;
  /** Nom du projet, sinon celui du dépôt ou du dossier ; null si le
   * segment est arrivé sans rien (anciennes sessions hors git). */
  label: string | null;
  startAt: Date;
  endAt: Date;
  /** Minutes brutes du bloc (union des segments, sans partage). */
  minutes: number;
};

export const BLOCK_GAP_MS = 30 * 60_000;

export function mergeSegmentsIntoBlocks(
  rows: readonly ClaudeSegment[],
  names: ReadonlyMap<string, string>,
  gapMs = BLOCK_GAP_MS,
): ClaudeBlock[] {
  const sorted = [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const open = new Map<string, ClaudeBlock & { covered: number; lastEnd: number }>();
  const out: ClaudeBlock[] = [];

  const close = (key: string) => {
    const b = open.get(key);
    if (!b) return;
    open.delete(key);
    const { covered, lastEnd: _ignored, ...block } = b;
    out.push({ ...block, minutes: Math.round(covered / 60_000) });
  };

  for (const r of sorted) {
    const key = `${r.userId}|${r.projectId ?? `remote:${r.remote ?? ""}`}`;
    const start = r.startedAt.getTime();
    const end = r.endedAt.getTime();
    const cur = open.get(key);
    if (cur && start - cur.lastEnd <= gapMs) {
      cur.segmentIds.push(r.id);
      // Minutes couvertes : on n'additionne que ce qui dépasse la fin déjà vue.
      cur.covered += Math.max(0, end - Math.max(start, cur.lastEnd));
      cur.lastEnd = Math.max(cur.lastEnd, end);
      cur.endAt = new Date(cur.lastEnd);
      continue;
    }
    close(key);
    const projectName = r.projectId ? (names.get(r.projectId) ?? null) : null;
    open.set(key, {
      id: r.id,
      segmentIds: [r.id],
      projectId: r.projectId,
      projectName,
      remote: r.remote,
      label: projectName ?? (r.remote ? repoKeyLabel(r.remote) : null),
      startAt: r.startedAt,
      endAt: r.endedAt,
      minutes: 0,
      covered: end - start,
      lastEnd: end,
    });
  }
  for (const key of [...open.keys()]) close(key);
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Titre proposé pour le créneau créé depuis un bloc. */
export function claudeBlockTitle(block: Pick<ClaudeBlock, "projectName" | "remote">): string {
  if (block.projectName) return block.projectName;
  if (block.remote) return gitRemoteBasename(block.remote);
  return "Claude Code";
}

export const segmentColumns = {
  id: claudeCodeActivity.id,
  userId: claudeCodeActivity.userId,
  projectId: claudeCodeActivity.projectId,
  remote: claudeCodeActivity.remote,
  startedAt: claudeCodeActivity.startedAt,
  endedAt: claudeCodeActivity.endedAt,
  sourceRef: claudeCodeActivity.sourceRef,
};

export async function projectNames(
  conn: Database,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const found = await conn
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, [...ids]));
  for (const p of found) names.set(p.id, p.name);
  return names;
}

/** Blocs non imputés d'un utilisateur dont le début tombe dans [start, end). */
export async function fetchClaudeBlocks(
  conn: Database,
  userId: string,
  start: Date,
  end: Date,
): Promise<ClaudeBlock[]> {
  const rows = await conn
    .select(segmentColumns)
    .from(claudeCodeActivity)
    .where(
      and(
        eq(claudeCodeActivity.userId, userId),
        isNull(claudeCodeActivity.timeEntryId),
        gte(claudeCodeActivity.startedAt, start),
        lt(claudeCodeActivity.startedAt, end),
      ),
    )
    .orderBy(asc(claudeCodeActivity.startedAt));
  if (rows.length === 0) return [];
  const names = await projectNames(conn, [
    ...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id)),
  ]);
  return mergeSegmentsIntoBlocks(rows, names);
}

/**
 * Segments d'un bloc que l'utilisateur peut encore imputer : les siens,
 * pas déjà tranchés. Un bloc tranché ailleurs (autre onglet, double appel)
 * ne doit pas produire un second créneau : l'appelant refuse si la liste
 * revient vide alors qu'il en demandait.
 */
export async function claimableClaudeSegments(
  conn: Database,
  userId: string,
  ids: readonly string[],
): Promise<{ id: string; sourceRef: string }[]> {
  if (ids.length === 0) return [];
  return conn
    .select({ id: claudeCodeActivity.id, sourceRef: claudeCodeActivity.sourceRef })
    .from(claudeCodeActivity)
    .where(
      and(
        inArray(claudeCodeActivity.id, [...ids]),
        eq(claudeCodeActivity.userId, userId),
        isNull(claudeCodeActivity.timeEntryId),
      ),
    )
    .orderBy(asc(claudeCodeActivity.startedAt));
}

/** Marque des segments comme imputés dans ce créneau. */
export async function attachClaudeSegments(
  conn: Database,
  ids: readonly string[],
  timeEntryId: string,
): Promise<void> {
  if (ids.length === 0) return;
  await conn
    .update(claudeCodeActivity)
    .set({ timeEntryId, updatedAt: new Date() })
    .where(inArray(claudeCodeActivity.id, [...ids]));
}
