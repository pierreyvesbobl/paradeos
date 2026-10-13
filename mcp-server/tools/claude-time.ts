/**
 * Suivi du temps passé dans Claude Code (cf. claude-mod/).
 *
 * Trois tools, appelés par le mod et non par le modèle :
 *  - resolve_repo       : remote git → projet Parade OS, ou candidats
 *  - link_repo          : rattache un remote à un projet (partagé entre machines)
 *  - track_claude_time  : upsert d'un segment d'activité (idempotent par source_ref)
 *
 * `track_claude_time` écrit dans `claude_code_activity`, pas dans
 * `time_entries` : le temps passé dans Claude Code est un signal
 * d'imputation que l'humain arbitre, jamais un créneau réalisé.
 */
import { desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { claudeCodeActivity } from "../../db/schema/claude-activity";
import { projectRepos } from "../../db/schema/project-repos";
import { projects } from "../../db/schema/projects";
import { gitRemoteBasename, normalizeGitRemote } from "../../lib/git/remote";
import type { UserContext } from "../context";
import { db } from "../db";

const CLOSED_STATUSES = ["lost", "archived", "completed"] as const;

function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 3 = même nom, 2 = l'un contient l'autre, 1 = un mot de 4+ lettres en commun. */
function nameAffinity(repoName: string, projectName: string): number {
  const a = foldName(repoName);
  const b = foldName(projectName);
  if (!a || !b) return 0;
  if (a === b || a.replace(/ /g, "") === b.replace(/ /g, "")) return 3;
  if (a.includes(b) || b.includes(a)) return 2;
  const tokens = new Set(a.split(" ").filter((t) => t.length >= 4));
  return b.split(" ").some((t) => tokens.has(t)) ? 1 : 0;
}

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

  const conn = db();
  const open = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(notInArray(projects.status, [...CLOSED_STATUSES]))
    .orderBy(desc(projects.updatedAt))
    .limit(300);

  const basename = gitRemoteBasename(remote);
  const candidates = open
    .map((p, idx) => ({ ...p, score: nameAffinity(basename, p.name), idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, 3)
    .map(({ id, name, kind, score }) => ({ id, name, kind, score }));

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

  await conn
    .insert(projectRepos)
    .values({ projectId, remote, createdBy: ctx.userId })
    .onConflictDoUpdate({
      target: projectRepos.remote,
      set: { projectId, createdBy: ctx.userId, createdAt: new Date() },
    });

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
  // sans rien demander dans Claude Code.
  const remote = args.remote ? normalizeGitRemote(args.remote) : null;
  let projectId = args.projectId ?? null;
  if (!projectId && remote) projectId = (await linkedProject(remote))?.id ?? null;

  const conn = db();
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
  return row;
}
