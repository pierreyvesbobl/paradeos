import { and, desc, eq, isNull, notInArray, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import { claudeCodeActivity } from "@/db/schema/claude-activity";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { gitRemoteBasename, normalizeGitRemote } from "@/lib/git/remote";

/**
 * Rattachement d'un dépôt git à un projet, partagé entre la Server Action
 * de la fiche projet et le tool MCP `track_claude_time`. Prend l'une ou
 * l'autre connexion Drizzle (cf. mcp-server/db.ts).
 *
 * Le rattachement se décide par affinité de nom entre le dépôt et les
 * projets ouverts. Un seul candidat net → automatique, sans rien demander.
 * Plusieurs candidats, ou aucun → doute, le signal reste « non rattaché »
 * dans /temps et l'humain choisit.
 */
export const CLOSED_STATUSES = ["lost", "archived", "completed"] as const;

export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * 3 = même nom (espaces ignorés : « Parade OS » ↔ `paradeos`),
 * 2 = l'un contient l'autre (« Thermigo » ↔ `thermigo-landing`),
 * 1 = un mot de 4+ lettres en commun, 0 = rien.
 */
export function nameAffinity(repoName: string, projectName: string): number {
  const a = foldName(repoName);
  const b = foldName(projectName);
  if (!a || !b) return 0;
  const aTight = a.replace(/ /g, "");
  const bTight = b.replace(/ /g, "");
  if (a === b || aTight === bTight) return 3;
  // Espaces ignorés des deux côtés : « Mise en place de Parade OS » contient
  // bien `paradeos`. Garde-fou sur la longueur : un dépôt `os` ou `api` ne
  // doit pas s'accrocher à n'importe quel nom.
  const shorter = Math.min(aTight.length, bTight.length);
  if (shorter >= 5 && (aTight.includes(bTight) || bTight.includes(aTight))) return 2;
  const tokens = new Set(a.split(" ").filter((t) => t.length >= 4));
  return b.split(" ").some((t) => tokens.has(t)) ? 1 : 0;
}

export type RepoCandidate = { id: string; name: string; score: number };

/** Projets classés par affinité, les plus récents d'abord à score égal.
 * Accepte l'URL brute ou la clé normalisée. */
export function rankProjects(
  remote: string,
  open: readonly { id: string; name: string }[],
): RepoCandidate[] {
  const basename = gitRemoteBasename(normalizeGitRemote(remote) ?? remote);
  return open
    .map((p, idx) => ({ id: p.id, name: p.name, score: nameAffinity(basename, p.name), idx }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map(({ id, name, score }) => ({ id, name, score }));
}

/** Seuil à partir duquel un candidat compte comme sérieux. */
const AUTO_MIN_SCORE = 2;

/**
 * Le candidat à rattacher sans demander, ou null s'il y a doute : il faut
 * un seul candidat sérieux (même nom, ou l'un contient l'autre). Deux
 * projets « Thermigo » et « Thermigo v2 » pour un dépôt `thermigo` sont
 * un doute, pas un choix.
 */
export function decideAutoLink(candidates: readonly RepoCandidate[]): RepoCandidate | null {
  const serious = candidates.filter((c) => c.score >= AUTO_MIN_SCORE);
  return serious.length === 1 ? (serious[0] ?? null) : null;
}

export async function listOpenProjects(conn: Database): Promise<{ id: string; name: string }[]> {
  return conn
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(notInArray(projects.status, [...CLOSED_STATUSES]))
    .orderBy(desc(projects.updatedAt))
    .limit(300);
}

export async function suggestProjects(conn: Database, remote: string): Promise<RepoCandidate[]> {
  return rankProjects(remote, await listOpenProjects(conn));
}

/**
 * Rattache (ou déplace) un dépôt, puis impute rétroactivement l'activité
 * Claude Code déjà poussée sous ce remote : celle arrivée sans projet, et,
 * quand le dépôt change de projet, celle imputée à l'ancien — un mauvais
 * rattachement se corrige d'un geste, le signal suit. Les créneaux réalisés
 * (`time_entries`) ne bougent pas : ce sont des décisions humaines.
 */
export async function linkRemote(
  conn: Database,
  input: { remote: string; projectId: string; userId: string | null; auto: boolean },
): Promise<{ id: string; remote: string; backfilled: number; previousProjectId: string | null }> {
  const [previous] = await conn
    .select({ projectId: projectRepos.projectId })
    .from(projectRepos)
    .where(eq(projectRepos.remote, input.remote))
    .limit(1);
  const previousProjectId =
    previous && previous.projectId !== input.projectId ? previous.projectId : null;

  const [row] = await conn
    .insert(projectRepos)
    .values({
      projectId: input.projectId,
      remote: input.remote,
      createdBy: input.userId,
      autoLinked: input.auto,
    })
    .onConflictDoUpdate({
      target: projectRepos.remote,
      set: {
        projectId: input.projectId,
        createdBy: input.userId,
        autoLinked: input.auto,
        createdAt: new Date(),
      },
    })
    .returning({ id: projectRepos.id, remote: projectRepos.remote });
  if (!row) throw new Error("Rattachement impossible.");

  const backfilled = await conn
    .update(claudeCodeActivity)
    .set({ projectId: input.projectId, updatedAt: new Date() })
    .where(
      and(
        eq(claudeCodeActivity.remote, input.remote),
        previousProjectId
          ? or(
              isNull(claudeCodeActivity.projectId),
              eq(claudeCodeActivity.projectId, previousProjectId),
            )
          : isNull(claudeCodeActivity.projectId),
      ),
    )
    .returning({ id: claudeCodeActivity.id });

  return { ...row, backfilled: backfilled.length, previousProjectId };
}
