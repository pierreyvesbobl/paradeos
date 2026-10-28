import "server-only";

import { and, eq, gt, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { projectRepos } from "@/db/schema/project-repos";
import { repoRoadmaps, taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { tasks } from "@/db/schema/tasks";
import { autoConfirmRoadmapLinks, getAutoConfirmMin } from "@/lib/dev/auto-confirm";
import { getRepoFile } from "@/lib/github/contents";
import { parseGithubRepo } from "@/lib/github/remote";
import { applyRoadmapStatuses } from "@/lib/roadmap/apply";
import { suggestRoadmapLinks } from "@/lib/roadmap/match";
import { flattenItems, parseRoadmap, type Roadmap } from "@/lib/roadmap/roadmap";

export { applyRoadmapStatuses, applyRoadmapStatusToTask } from "@/lib/roadmap/apply";

type Conn = Pick<Database, "select" | "update" | "insert" | "delete">;

export type RoadmapRepo = { remote: string; roadmapPath: string; projectId: string };

export type RoadmapSyncResult = {
  remote: string;
  status: "ok" | "error";
  message?: string;
  /** Items lus dans la feuille de route. */
  items: number;
  /** Tâches dont le statut a suivi celui de leur item. */
  changedTasks: number;
  /** Nouvelles suggestions tâche ↔ item. */
  suggested: number;
  /** Suggestions confirmées sans clic (seuil de confiance). */
  autoConfirmed: number;
};

/**
 * Propose des paires tâche ↔ item pour les tâches ouvertes du projet qui
 * n'ont pas de lien confirmé. Les paires déjà tranchées ou déjà proposées
 * ne reviennent pas. Renvoie le nombre de suggestions insérées.
 */
async function matchOpenTasks(conn: Conn, repo: RoadmapRepo, roadmap: Roadmap): Promise<number> {
  const confirmed = conn
    .select({ taskId: taskRoadmapLinks.taskId })
    .from(taskRoadmapLinks)
    .where(eq(taskRoadmapLinks.status, "confirmed"));
  const candidates = await conn
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      kind: tasks.kind,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, repo.projectId),
        notInArray(tasks.status, ["done", "cancelled"]),
        notInArray(tasks.id, confirmed),
      ),
    );
  if (candidates.length === 0) return 0;

  const items = flattenItems(roadmap);
  const suggestions = await suggestRoadmapLinks(candidates, items);
  if (suggestions.length === 0) return 0;

  const existing = await conn
    .select({ taskId: taskRoadmapLinks.taskId, itemId: taskRoadmapLinks.itemId })
    .from(taskRoadmapLinks)
    .where(
      and(
        eq(taskRoadmapLinks.remote, repo.remote),
        inArray(
          taskRoadmapLinks.taskId,
          suggestions.map((s) => s.taskId),
        ),
      ),
    );
  const seen = new Set(existing.map((e) => `${e.taskId}#${e.itemId}`));
  const fresh = suggestions.filter((s) => !seen.has(`${s.taskId}#${s.itemId}`));
  if (fresh.length === 0) return 0;
  await conn.insert(taskRoadmapLinks).values(
    fresh.map((s) => ({
      taskId: s.taskId,
      remote: repo.remote,
      itemId: s.itemId,
      status: "suggested" as const,
      confidence: s.confidence,
      reason: s.reason,
    })),
  );
  return fresh.length;
}

/**
 * Une passe complète sur un dépôt : lecture du fichier, instantané,
 * propagation des statuts sur les liens confirmés, rapprochement LLM si la
 * feuille de route ou les tâches ont bougé depuis le dernier, puis
 * confirmation sans clic des suggestions au-dessus du seuil.
 */
export async function syncRepoRoadmap(conn: Conn, repo: RoadmapRepo): Promise<RoadmapSyncResult> {
  const base = { remote: repo.remote, items: 0, changedTasks: 0, suggested: 0, autoConfirmed: 0 };
  const ref = parseGithubRepo(repo.remote);
  if (!ref) return { ...base, status: "error", message: "Dépôt hors GitHub." };

  const file = await getRepoFile(ref, repo.roadmapPath);
  if (file.status === "no_token") {
    return { ...base, status: "error", message: "Aucun jeton GitHub enregistré." };
  }
  if (file.status === "error") return { ...base, status: "error", message: file.message };

  const roadmap = parseRoadmap(file.text);
  if (!roadmap) {
    return {
      ...base,
      status: "error",
      message: `${repo.roadmapPath} n'est pas une feuille de route lisible.`,
    };
  }
  const items = flattenItems(roadmap).length;

  const [previous] = await conn
    .select({ matchedAt: repoRoadmaps.matchedAt, matchedSha: repoRoadmaps.matchedSha })
    .from(repoRoadmaps)
    .where(eq(repoRoadmaps.remote, repo.remote))
    .limit(1);
  await conn
    .insert(repoRoadmaps)
    .values({
      remote: repo.remote,
      path: repo.roadmapPath,
      sha: file.sha,
      content: roadmap,
      fetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: repoRoadmaps.remote,
      set: {
        path: repo.roadmapPath,
        sha: file.sha,
        content: roadmap,
        fetchedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  const changedTasks = await applyRoadmapStatuses(conn, repo.remote, roadmap);

  let suggested = 0;
  let message: string | undefined;
  const needsMatch =
    !previous?.matchedAt ||
    previous.matchedSha !== file.sha ||
    (await hasTasksCreatedSince(conn, repo.projectId, previous.matchedAt));
  if (needsMatch) {
    try {
      suggested = await matchOpenTasks(conn, repo, roadmap);
      await conn
        .update(repoRoadmaps)
        .set({ matchedAt: new Date(), matchedSha: file.sha })
        .where(eq(repoRoadmaps.remote, repo.remote));
    } catch (err) {
      message = `Rapprochement non fait : ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const autoConfirmed = await autoConfirmRoadmapLinks(conn, repo.remote, await getAutoConfirmMin());
  return { ...base, status: "ok", message, items, changedTasks, suggested, autoConfirmed };
}

async function hasTasksCreatedSince(conn: Conn, projectId: string, since: Date): Promise<boolean> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), gt(tasks.createdAt, since)));
  return (row?.n ?? 0) > 0;
}

/** Tous les dépôts avec une feuille de route, ou ceux d'un projet. */
export async function listRoadmapRepos(conn: Conn, projectId?: string): Promise<RoadmapRepo[]> {
  const rows = await conn
    .select({
      remote: projectRepos.remote,
      roadmapPath: projectRepos.roadmapPath,
      projectId: projectRepos.projectId,
    })
    .from(projectRepos)
    .where(
      projectId
        ? and(isNotNull(projectRepos.roadmapPath), eq(projectRepos.projectId, projectId))
        : isNotNull(projectRepos.roadmapPath),
    );
  return rows.filter((r): r is RoadmapRepo => typeof r.roadmapPath === "string");
}

export async function syncRoadmaps(conn: Conn, projectId?: string): Promise<RoadmapSyncResult[]> {
  const repos = await listRoadmapRepos(conn, projectId);
  const out: RoadmapSyncResult[] = [];
  for (const repo of repos) {
    try {
      out.push(await syncRepoRoadmap(conn, repo));
    } catch (err) {
      out.push({
        remote: repo.remote,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        items: 0,
        changedTasks: 0,
        suggested: 0,
        autoConfirmed: 0,
      });
    }
  }
  return out;
}
