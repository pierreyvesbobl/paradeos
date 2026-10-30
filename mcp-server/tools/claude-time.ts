/**
 * Suivi du temps passé dans Claude Code (cf. claude-mod/).
 *
 * Trois tools appelés par le mod, pas par le modèle :
 *  - resolve_repo       : remote git → projet Parade OS, ou candidats
 *  - link_repo          : rattache un remote à un projet (partagé entre machines)
 *  - track_claude_time  : upsert d'un segment d'activité (idempotent par source_ref)
 *
 * Et un tool pour l'humain qui consolide sa journée depuis Claude :
 *  - list_claude_activity : les blocs à imputer (séances fusionnées), que
 *    `log_time` transforme en créneau avec `claudeSegmentIds`.
 *  - update_claude_activity : corrige un lot de segments (bornes, projet).
 *
 * `track_claude_time` écrit dans `claude_code_activity`, pas dans
 * `time_entries` : le temps passé dans Claude Code est un signal
 * d'imputation que l'humain arbitre, jamais un créneau réalisé.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { claudeCodeActivity } from "../../db/schema/claude-activity";
import { projectRepos } from "../../db/schema/project-repos";
import { projects } from "../../db/schema/projects";
import { localRepoKey, normalizeGitRemote } from "../../lib/git/remote";
import { decideAutoLink, foldName, linkRemote, suggestProjects } from "../../lib/repos/link";
import { claudeBlockTitle, fetchClaudeBlocks } from "../../lib/time/claude-blocks";
import type { UserContext } from "../context";
import { db } from "../db";

async function linkedProject(remote: string) {
  const conn = db();
  const [row] = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      status: projects.status,
    })
    .from(projectRepos)
    .innerJoin(projects, eq(projects.id, projectRepos.projectId))
    .where(eq(projectRepos.remote, remote))
    .limit(1);
  return row ?? null;
}

export const resolveRepoSchema = z.object({
  /** URL du remote telle que git la donne (SSH ou HTTPS), ou déjà normalisée. */
  remote: z.string().trim().min(1).max(500),
});

export async function resolveRepo(args: z.infer<typeof resolveRepoSchema>) {
  const remote = normalizeGitRemote(args.remote);
  if (!remote) {
    return { remote: null, linked: false as const, project: null, candidates: [] };
  }
  const project = await linkedProject(remote);
  if (project) return { remote, linked: true as const, project, candidates: [] };

  const candidates = (await suggestProjects(db(), remote)).slice(0, 3);
  return { remote, linked: false as const, project: null, candidates };
}

export const linkRepoSchema = z
  .object({
    remote: z.string().trim().min(1).max(500),
    projectId: z.string().uuid().optional(),
    /** Recherche par nom si `projectId` absent ; doit matcher un seul projet. */
    projectName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.projectId || v.projectName, {
    message: "Fournis `projectId` ou `projectName`.",
  });

export async function linkRepo(args: z.infer<typeof linkRepoSchema>, ctx: UserContext) {
  const remote = normalizeGitRemote(args.remote);
  if (!remote) throw new Error(`Remote illisible : ${args.remote}`);
  const conn = db();

  let projectId = args.projectId ?? null;
  if (!projectId && args.projectName) {
    const matches = await conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        sql`lower(${projects.name}) like ${`%${args.projectName.toLowerCase()}%`} and ${projects.status} not in ('lost', 'archived')`,
      )
      .limit(5);
    const exact = matches.filter((m) => foldName(m.name) === foldName(args.projectName ?? ""));
    const pick = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
    if (!pick) {
      throw new Error(
        matches.length === 0
          ? `Aucun projet ne correspond à « ${args.projectName} ».`
          : `Plusieurs projets correspondent à « ${args.projectName} » : ${matches.map((m) => m.name).join(", ")}.`,
      );
    }
    projectId = pick.id;
  }
  if (!projectId) throw new Error("Projet introuvable.");

  await linkRemote(conn, { remote, projectId, userId: ctx.userId, auto: false });
  const project = await linkedProject(remote);
  return { remote, project };
}

export const trackClaudeTimeSchema = z.object({
  /** `<sessionId>:<segment>` — réécrit quand le segment s'étend. */
  sourceRef: z.string().trim().min(1).max(200),
  startAt: z.string(),
  endAt: z.string(),
  /** Remote git de la session. Le projet s'en déduit (`project_repos`). */
  remote: z.string().trim().max(500).nullable().optional(),
  /** Dossier de travail (chemin ou nom), utilisé sans remote : la clé
   * `local/<dossier>` tient alors lieu de dépôt (cf. lib/git/remote.ts). */
  workdir: z.string().trim().max(500).nullable().optional(),
  /** Forçage explicite ; sinon le projet vient du rattachement du remote. */
  projectId: z.string().uuid().nullable().optional(),
});

export async function trackClaudeTime(
  args: z.infer<typeof trackClaudeTimeSchema>,
  ctx: UserContext,
) {
  const start = new Date(args.startAt);
  const end = new Date(args.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("startAt / endAt doivent être des dates ISO 8601 valides.");
  }
  if (end <= start) throw new Error("endAt doit être > startAt.");

  // Le projet se déduit du rattachement du dépôt, à chaque push : rattacher
  // un dépôt depuis la fiche projet impute aussitôt les segments suivants,
  // sans rien demander dans Claude Code. Dépôt inconnu : si un seul projet
  // ouvert porte son nom, on le rattache ici même ; sinon le signal reste
  // « non rattaché » dans /temps, où l'humain tranche.
  const conn = db();
  const remote = normalizeGitRemote(args.remote) ?? localRepoKey(args.workdir);
  let projectId = args.projectId ?? null;
  let autoLinked: { id: string; name: string } | null = null;
  if (!projectId && remote) {
    projectId = (await linkedProject(remote))?.id ?? null;
    if (!projectId) {
      const picked = decideAutoLink(await suggestProjects(conn, remote));
      if (picked) {
        await linkRemote(conn, { remote, projectId: picked.id, userId: ctx.userId, auto: true });
        projectId = picked.id;
        autoLinked = { id: picked.id, name: picked.name };
      }
    }
  }

  const [row] = await conn
    .insert(claudeCodeActivity)
    .values({
      userId: ctx.userId,
      sourceRef: args.sourceRef,
      startedAt: start,
      endedAt: end,
      projectId,
      remote,
    })
    .onConflictDoUpdate({
      target: [claudeCodeActivity.userId, claudeCodeActivity.sourceRef],
      set: {
        startedAt: start,
        endedAt: end,
        projectId,
        remote,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: claudeCodeActivity.id,
      startAt: claudeCodeActivity.startedAt,
      endAt: claudeCodeActivity.endedAt,
    });
  return { ...row, projectId, autoLinked };
}

export const listClaudeActivitySchema = z.object({
  /** Jour (YYYY-MM-DD, Europe/Paris). Défaut : aujourd'hui. Ignoré si `from`/`to`. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Bornes ISO 8601 explicites, [from, to). */
  from: z.string().optional(),
  to: z.string().optional(),
});

const TIME_ZONE = "Europe/Paris";

/** Décalage (ms) de `TIME_ZONE` par rapport à UTC à l'instant donné. */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/** Journée civile de Paris [00:00, 24:00) pour une date YYYY-MM-DD. */
export function parisDayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  const start = new Date(naive - tzOffsetMs(new Date(naive)));
  const nextNaive = Date.UTC(y, m - 1, d + 1);
  const end = new Date(nextNaive - tzOffsetMs(new Date(nextNaive)));
  return { start, end };
}

function todayParis(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export async function listClaudeActivity(
  args: z.infer<typeof listClaudeActivitySchema>,
  ctx: UserContext,
) {
  let start: Date;
  let end: Date;
  if (args.from || args.to) {
    start = args.from ? new Date(args.from) : new Date(0);
    end = args.to ? new Date(args.to) : new Date(Date.now() + 365 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("from / to doivent être des dates ISO 8601 valides.");
    }
  } else {
    ({ start, end } = parisDayRange(args.date ?? todayParis()));
  }

  const blocks = await fetchClaudeBlocks(db(), ctx.userId, start, end);
  const totalMinutes = blocks.reduce((acc, b) => acc + b.minutes, 0);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    totalMinutes,
    blocks: blocks.map((b) => ({
      segmentIds: b.segmentIds,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      minutes: b.minutes,
      projectId: b.projectId,
      projectName: b.projectName,
      remote: b.remote,
      label: b.label,
      suggestedTitle: claudeBlockTitle(b),
    })),
    hint:
      blocks.length === 0
        ? "Rien à imputer sur la période."
        : "Pour imputer un bloc : log_time avec startAt/endAt (ajustables), projectId et claudeSegmentIds = segmentIds du bloc. Un bloc dont le projet est null vient d'un dépôt ou dossier non rattaché : demande le projet, ou link_repo pour rattacher le remote.",
  };
}

export const updateClaudeActivitySchema = z.object({
  /** Un patch par segment (ids de `segmentIds` dans list_claude_activity) :
   * seuls les champs fournis changent, `projectId: null` détache. */
  segments: z
    .array(
      z.object({
        id: z.string().uuid(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        projectId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

function parseDate(value: string, field: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} doit être une date ISO 8601 valide.`);
  return d;
}

export async function updateClaudeActivity(
  args: z.infer<typeof updateClaudeActivitySchema>,
  ctx: UserContext,
) {
  const conn = db();
  const ids = [...new Set(args.segments.map((s) => s.id))];
  if (ids.length !== args.segments.length) throw new Error("Un même segment apparaît deux fois.");

  const existing = await conn
    .select({
      id: claudeCodeActivity.id,
      startedAt: claudeCodeActivity.startedAt,
      endedAt: claudeCodeActivity.endedAt,
    })
    .from(claudeCodeActivity)
    .where(and(eq(claudeCodeActivity.userId, ctx.userId), inArray(claudeCodeActivity.id, ids)));
  const byId = new Map(existing.map((r) => [r.id, r]));

  // Tout est validé avant la première écriture : un lot passe en entier ou pas du tout.
  const patches = args.segments.flatMap((s) => {
    const current = byId.get(s.id);
    if (!current) return [];
    const startedAt = s.startAt !== undefined ? parseDate(s.startAt, "startAt") : current.startedAt;
    const endedAt = s.endAt !== undefined ? parseDate(s.endAt, "endAt") : current.endedAt;
    if (endedAt <= startedAt) throw new Error(`Segment ${s.id} : endAt doit être > startAt.`);
    const set: Partial<typeof claudeCodeActivity.$inferInsert> = { updatedAt: new Date() };
    if (s.startAt !== undefined) set.startedAt = startedAt;
    if (s.endAt !== undefined) set.endedAt = endedAt;
    if (s.projectId !== undefined) set.projectId = s.projectId;
    return [{ id: s.id, set }];
  });

  await conn.transaction(async (tx) => {
    for (const p of patches) {
      await tx
        .update(claudeCodeActivity)
        .set(p.set)
        .where(and(eq(claudeCodeActivity.id, p.id), eq(claudeCodeActivity.userId, ctx.userId)));
    }
  });

  return {
    updated: patches.map((p) => p.id),
    notFound: ids.filter((id) => !byId.has(id)),
  };
}
