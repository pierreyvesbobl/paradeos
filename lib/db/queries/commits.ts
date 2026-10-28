import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { repoCommits, taskCommitLinks } from "@/db/schema/repo-commits";
import type { RoadmapLinkStatus } from "@/db/schema/repo-roadmaps";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";
import { listFollowedRepos } from "@/lib/repos/commits-sync";

export type CommitLinkRow = {
  id: string;
  taskId: string;
  status: RoadmapLinkStatus;
  confidence: number | null;
  reason: string | null;
  taskTitle: string;
  taskStatus: string;
};

export type CommitRow = {
  remote: string;
  sha: string;
  subject: string;
  body: string | null;
  author: string | null;
  committedAt: Date;
  url: string | null;
  source: "github" | "claude_code";
  links: CommitLinkRow[];
};

export type ProjectCommitsView = {
  commits: CommitRow[];
  /** Plusieurs dépôts suivis : le nom du dépôt s'affiche. */
  multiRepo: boolean;
  /** Tâches ouvertes du projet, pour la liaison manuelle. */
  openTasks: { id: string; title: string }[];
};

const LIMIT = 30;

/** Les derniers commits des dépôts suivis du projet, avec leurs liens. */
export async function getProjectCommits(projectId: string): Promise<ProjectCommitsView> {
  const conn = await db();
  const repos = await listFollowedRepos(conn, projectId);
  if (repos.length === 0) return { commits: [], multiRepo: false, openTasks: [] };
  const remotes = repos.map((r) => r.remote);

  const [rows, openTasks] = await Promise.all([
    conn
      .select({
        remote: repoCommits.remote,
        sha: repoCommits.sha,
        subject: repoCommits.subject,
        body: repoCommits.body,
        author: repoCommits.author,
        committedAt: repoCommits.committedAt,
        url: repoCommits.url,
        source: repoCommits.source,
      })
      .from(repoCommits)
      .where(inArray(repoCommits.remote, remotes))
      .orderBy(desc(repoCommits.committedAt))
      .limit(LIMIT),
    conn
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), notInArray(tasks.status, ["done", "cancelled"])))
      .orderBy(tasks.title),
  ]);
  if (rows.length === 0) return { commits: [], multiRepo: repos.length > 1, openTasks };

  const links = await conn
    .select({
      id: taskCommitLinks.id,
      remote: taskCommitLinks.remote,
      sha: taskCommitLinks.sha,
      taskId: taskCommitLinks.taskId,
      status: taskCommitLinks.status,
      confidence: taskCommitLinks.confidence,
      reason: taskCommitLinks.reason,
      taskTitle: tasks.title,
      taskStatus: tasks.status,
    })
    .from(taskCommitLinks)
    .innerJoin(tasks, eq(taskCommitLinks.taskId, tasks.id))
    .where(
      inArray(
        taskCommitLinks.sha,
        rows.map((r) => r.sha),
      ),
    );

  return {
    commits: rows.map((r) => ({
      ...r,
      links: links
        .filter((l) => l.remote === r.remote && l.sha === r.sha)
        .map(({ remote: _r, sha: _s, ...l }) => l),
    })),
    multiRepo: repos.length > 1,
    openTasks,
  };
}
