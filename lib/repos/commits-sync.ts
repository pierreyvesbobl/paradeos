import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { projectRepos } from "@/db/schema/project-repos";
import { repoCommits, taskCommitLinks } from "@/db/schema/repo-commits";
import { tasks } from "@/db/schema/tasks";
import { autoConfirmCommitLinks, getAutoConfirmMin } from "@/lib/dev/auto-confirm";
import { listCommitsSince } from "@/lib/github/commits";
import { parseGithubRepo } from "@/lib/github/remote";
import { upsertCommits } from "@/lib/repos/commits";
import { suggestCommitLinks } from "@/lib/repos/match-commits";

type Conn = Pick<Database, "select" | "update" | "insert" | "delete">;

export type FollowedRepo = { remote: string; projectId: string };

/** Fenêtre lue à la première passe sur un dépôt. */
const FIRST_SYNC_DAYS = 30;
/** Commits examinés par passe de rapprochement : au-delà, deepseek-v4-pro dépasse le budget. */
const MATCH_BATCH = 15;

export type CommitSyncResult = {
  remote: string;
  status: "ok" | "error";
  message?: string;
  /** Commits nouveaux lus sur GitHub. */
  added: number;
  /** Nouvelles suggestions commit ↔ tâche. */
  suggested: number;
  /** Suggestions confirmées sans clic (seuil de confiance). */
  autoConfirmed: number;
};

/** Dépôts GitHub suivis : feuille de route ou projection d'issues activée. */
export async function listFollowedRepos(conn: Conn, projectId?: string): Promise<FollowedRepo[]> {
  const followed = or(isNotNull(projectRepos.roadmapPath), eq(projectRepos.syncIssues, true));
  const rows = await conn
    .select({ remote: projectRepos.remote, projectId: projectRepos.projectId })
    .from(projectRepos)
    .where(projectId ? and(followed, eq(projectRepos.projectId, projectId)) : followed);
  return rows.filter((r) => parseGithubRepo(r.remote) !== null);
}

/** Lit sur GitHub les commits plus récents que le dernier connu. */
export async function pullCommitsFromGithub(
  conn: Conn,
  repo: FollowedRepo,
): Promise<{ added: number; error?: string }> {
  const ref = parseGithubRepo(repo.remote);
  if (!ref) return { added: 0, error: "Dépôt hors GitHub." };
  const [last] = await conn
    .select({ at: sql<Date | null>`max(${repoCommits.committedAt})` })
    .from(repoCommits)
    .where(eq(repoCommits.remote, repo.remote));
  const since = last?.at
    ? new Date(new Date(last.at).getTime() - 60_000)
    : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  const result = await listCommitsSince(ref, since);
  if (result.status === "no_token") return { added: 0, error: "Aucun jeton GitHub enregistré." };
  if (result.status === "error") return { added: 0, error: result.message };
  const added = await upsertCommits(conn, repo.remote, result.commits, "github");
  return { added };
}

/**
 * Propose quelle tâche ouverte du projet chaque commit non encore examiné
 * livre. Les commits examinés sont marqués, même sans paire : on n'y
 * revient pas. Les paires déjà tranchées ne sont pas reproposées.
 */
export async function matchNewCommits(conn: Conn, repo: FollowedRepo): Promise<number> {
  const pending = await conn
    .select({
      sha: repoCommits.sha,
      subject: repoCommits.subject,
      body: repoCommits.body,
      committedAt: repoCommits.committedAt,
    })
    .from(repoCommits)
    .where(and(eq(repoCommits.remote, repo.remote), isNull(repoCommits.matchedAt)))
    .orderBy(desc(repoCommits.committedAt))
    .limit(MATCH_BATCH);
  if (pending.length === 0) return 0;

  const candidates = await conn
    .select({ id: tasks.id, title: tasks.title, description: tasks.description, kind: tasks.kind })
    .from(tasks)
    .where(
      and(eq(tasks.projectId, repo.projectId), notInArray(tasks.status, ["done", "cancelled"])),
    );

  let suggested = 0;
  if (candidates.length > 0) {
    const suggestions = await suggestCommitLinks(pending, candidates);
    if (suggestions.length > 0) {
      const existing = await conn
        .select({ taskId: taskCommitLinks.taskId, sha: taskCommitLinks.sha })
        .from(taskCommitLinks)
        .where(
          and(
            eq(taskCommitLinks.remote, repo.remote),
            inArray(
              taskCommitLinks.sha,
              suggestions.map((s) => s.sha),
            ),
          ),
        );
      const seen = new Set(existing.map((e) => `${e.taskId}#${e.sha}`));
      const fresh = suggestions.filter((s) => !seen.has(`${s.taskId}#${s.sha}`));
      if (fresh.length > 0) {
        await conn.insert(taskCommitLinks).values(
          fresh.map((s) => ({
            taskId: s.taskId,
            remote: repo.remote,
            sha: s.sha,
            status: "suggested" as const,
            confidence: s.confidence,
            reason: s.reason,
          })),
        );
        suggested = fresh.length;
      }
    }
  }
  await conn
    .update(repoCommits)
    .set({ matchedAt: new Date() })
    .where(
      and(
        eq(repoCommits.remote, repo.remote),
        inArray(
          repoCommits.sha,
          pending.map((p) => p.sha),
        ),
      ),
    );
  return suggested;
}

export async function syncRepoCommits(conn: Conn, repo: FollowedRepo): Promise<CommitSyncResult> {
  const pulled = await pullCommitsFromGithub(conn, repo);
  let suggested = 0;
  let message = pulled.error;
  try {
    suggested = await matchNewCommits(conn, repo);
  } catch (err) {
    message = `Rapprochement non fait : ${err instanceof Error ? err.message : String(err)}`;
  }
  const autoConfirmed = await autoConfirmCommitLinks(conn, repo.remote, await getAutoConfirmMin());
  return {
    remote: repo.remote,
    status: pulled.error ? "error" : "ok",
    message,
    added: pulled.added,
    suggested,
    autoConfirmed,
  };
}

export async function syncCommits(conn: Conn, projectId?: string): Promise<CommitSyncResult[]> {
  const repos = await listFollowedRepos(conn, projectId);
  const out: CommitSyncResult[] = [];
  for (const repo of repos) {
    try {
      out.push(await syncRepoCommits(conn, repo));
    } catch (err) {
      out.push({
        remote: repo.remote,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        added: 0,
        suggested: 0,
        autoConfirmed: 0,
      });
    }
  }
  return out;
}
