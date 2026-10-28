/**
 * Ce que Claude Code sait et dit de son travail (cf. claude-mod/).
 *
 *  - repo_context          : ce que le mod injecte dans le prompt système
 *                            d'une session ouverte dans un dépôt rattaché :
 *                            projet, tâches ouvertes, feuille de route,
 *                            derniers commits connus.
 *  - report_task_progress  : l'agent dit où en est une tâche (statut, note).
 *  - report_commits        : le mod pousse les commits faits en session,
 *                            poussés ou non ; GitHub est relu par ailleurs.
 */
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { notes } from "../../db/schema/notes";
import { projectRepos } from "../../db/schema/project-repos";
import { projects } from "../../db/schema/projects";
import { repoCommits } from "../../db/schema/repo-commits";
import { repoRoadmaps, taskRoadmapLinks } from "../../db/schema/repo-roadmaps";
import { tasks } from "../../db/schema/tasks";
import { normalizeGitRemote } from "../../lib/git/remote";
import { upsertCommits } from "../../lib/repos/commits";
import { flattenItems, roadmapFromStored } from "../../lib/roadmap/roadmap";
import { computeCompletedAt, markTaskDone } from "../../lib/tasks/complete";
import type { UserContext } from "../context";
import { db } from "../db";

export const repoContextSchema = z.object({
  /** URL du remote telle que git la donne (SSH ou HTTPS), ou déjà normalisée. */
  remote: z.string().trim().min(1).max(500),
});

export async function repoContext(args: z.infer<typeof repoContextSchema>) {
  const remote = normalizeGitRemote(args.remote);
  if (!remote) return { remote: null, project: null, tasks: [], roadmap: null, recentCommits: [] };
  const conn = db();
  const [repo] = await conn
    .select({
      projectId: projects.id,
      projectName: projects.name,
      roadmapPath: projectRepos.roadmapPath,
    })
    .from(projectRepos)
    .innerJoin(projects, eq(projectRepos.projectId, projects.id))
    .where(eq(projectRepos.remote, remote))
    .limit(1);
  if (!repo) return { remote, project: null, tasks: [], roadmap: null, recentCommits: [] };

  const openTasks = await conn
    .select({
      id: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      status: tasks.status,
      priority: tasks.priority,
    })
    .from(tasks)
    .where(
      and(eq(tasks.projectId, repo.projectId), notInArray(tasks.status, ["done", "cancelled"])),
    )
    .orderBy(desc(tasks.priority), tasks.title);

  const links =
    openTasks.length > 0
      ? await conn
          .select({ taskId: taskRoadmapLinks.taskId, itemId: taskRoadmapLinks.itemId })
          .from(taskRoadmapLinks)
          .where(
            and(
              eq(taskRoadmapLinks.remote, remote),
              eq(taskRoadmapLinks.status, "confirmed"),
              inArray(
                taskRoadmapLinks.taskId,
                openTasks.map((t) => t.id),
              ),
            ),
          )
      : [];
  const itemByTask = new Map(links.map((l) => [l.taskId, l.itemId]));

  let roadmap: {
    path: string;
    items: { id: string; status: string; title: string; taskIds: string[] }[];
  } | null = null;
  if (repo.roadmapPath) {
    const [snap] = await conn
      .select({ content: repoRoadmaps.content })
      .from(repoRoadmaps)
      .where(eq(repoRoadmaps.remote, remote))
      .limit(1);
    const parsed = snap ? roadmapFromStored(snap.content) : null;
    if (parsed) {
      roadmap = {
        path: repo.roadmapPath,
        items: flattenItems(parsed).map((i) => ({
          id: i.id,
          status: i.status,
          title: i.title,
          taskIds: links.filter((l) => l.itemId === i.id).map((l) => l.taskId),
        })),
      };
    }
  }

  const recentCommits = await conn
    .select({ sha: repoCommits.sha, subject: repoCommits.subject, at: repoCommits.committedAt })
    .from(repoCommits)
    .where(eq(repoCommits.remote, remote))
    .orderBy(desc(repoCommits.committedAt))
    .limit(5);

  return {
    remote,
    project: { id: repo.projectId, name: repo.projectName },
    tasks: openTasks.map((t) => ({ ...t, roadmapItem: itemByTask.get(t.id) ?? null })),
    roadmap,
    recentCommits: recentCommits.map((c) => ({
      sha: c.sha.slice(0, 7),
      subject: c.subject,
      date: c.at.toISOString().slice(0, 10),
    })),
  };
}

export const reportTaskProgressSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "awaiting_client", "blocked", "done"]),
  /** Une ou deux phrases : ce qui a été fait, ce qui bloque. */
  note: z.string().trim().max(2000).optional(),
});

export async function reportTaskProgress(
  args: z.infer<typeof reportTaskProgressSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [current] = await conn
    .select({ id: tasks.id, status: tasks.status, completedAt: tasks.completedAt })
    .from(tasks)
    .where(eq(tasks.id, args.taskId))
    .limit(1);
  if (!current) throw new Error("Tâche introuvable.");

  let changed = false;
  if (args.status === "done") {
    changed = (await markTaskDone(conn, args.taskId))?.changed ?? false;
  } else if (current.status !== args.status) {
    await conn
      .update(tasks)
      .set({
        status: args.status,
        completedAt: computeCompletedAt(args.status, current.completedAt),
      })
      .where(eq(tasks.id, args.taskId));
    changed = true;
  }
  if (args.note) {
    await conn.insert(notes).values({
      title: "Claude Code",
      content: args.note,
      kind: "memo",
      subjectType: "task",
      subjectId: args.taskId,
      authorId: ctx.userId,
    });
  }
  return { id: args.taskId, status: args.status, changed, noted: Boolean(args.note) };
}

export const reportCommitsSchema = z.object({
  remote: z.string().trim().min(1).max(500),
  commits: z
    .array(
      z.object({
        sha: z.string().trim().min(7).max(64),
        subject: z.string().trim().min(1).max(500),
        body: z.string().max(5000).nullable().optional(),
        author: z.string().max(200).nullable().optional(),
        committedAt: z.string(),
        url: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function reportCommits(args: z.infer<typeof reportCommitsSchema>) {
  const remote = normalizeGitRemote(args.remote);
  if (!remote) throw new Error(`Remote illisible : ${args.remote}`);
  const added = await upsertCommits(db(), remote, args.commits, "claude_code");
  return { remote, received: args.commits.length, added };
}
