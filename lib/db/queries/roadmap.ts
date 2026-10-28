import { and, asc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { projectRepos } from "@/db/schema/project-repos";
import { type RoadmapLinkStatus, repoRoadmaps, taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";
import { type Roadmap, roadmapFromStored } from "@/lib/roadmap/roadmap";

export type RoadmapLinkRow = {
  id: string;
  taskId: string;
  itemId: string;
  status: RoadmapLinkStatus;
  confidence: number | null;
  reason: string | null;
  taskTitle: string;
  taskStatus: string;
};

export type ProjectRoadmapView = {
  repoId: string;
  remote: string;
  path: string;
  snapshot: { roadmap: Roadmap; fetchedAt: Date } | null;
  links: RoadmapLinkRow[];
  /** Tâches ouvertes du projet sans lien confirmé, pour la liaison manuelle. */
  openTasks: { id: string; title: string }[];
};

/** Les feuilles de route des dépôts du projet, avec leurs liens. */
export async function getProjectRoadmaps(projectId: string): Promise<ProjectRoadmapView[]> {
  const conn = await db();
  const repos = await conn
    .select({ id: projectRepos.id, remote: projectRepos.remote, path: projectRepos.roadmapPath })
    .from(projectRepos)
    .where(and(eq(projectRepos.projectId, projectId), isNotNull(projectRepos.roadmapPath)))
    .orderBy(asc(projectRepos.createdAt));
  if (repos.length === 0) return [];
  const remotes = repos.map((r) => r.remote);

  const [snapshots, links, openTasks] = await Promise.all([
    conn
      .select({
        remote: repoRoadmaps.remote,
        content: repoRoadmaps.content,
        fetchedAt: repoRoadmaps.fetchedAt,
      })
      .from(repoRoadmaps)
      .where(inArray(repoRoadmaps.remote, remotes)),
    conn
      .select({
        id: taskRoadmapLinks.id,
        remote: taskRoadmapLinks.remote,
        taskId: taskRoadmapLinks.taskId,
        itemId: taskRoadmapLinks.itemId,
        status: taskRoadmapLinks.status,
        confidence: taskRoadmapLinks.confidence,
        reason: taskRoadmapLinks.reason,
        taskTitle: tasks.title,
        taskStatus: tasks.status,
      })
      .from(taskRoadmapLinks)
      .innerJoin(tasks, eq(taskRoadmapLinks.taskId, tasks.id))
      .where(inArray(taskRoadmapLinks.remote, remotes))
      .orderBy(asc(taskRoadmapLinks.createdAt)),
    conn
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          notInArray(tasks.status, ["done", "cancelled"]),
          notInArray(
            tasks.id,
            conn
              .select({ taskId: taskRoadmapLinks.taskId })
              .from(taskRoadmapLinks)
              .where(eq(taskRoadmapLinks.status, "confirmed")),
          ),
        ),
      )
      .orderBy(asc(tasks.title)),
  ]);

  const snapshotByRemote = new Map(snapshots.map((s) => [s.remote, s]));
  return repos.map((r) => {
    const snap = snapshotByRemote.get(r.remote);
    const roadmap = snap ? roadmapFromStored(snap.content) : null;
    return {
      repoId: r.id,
      remote: r.remote,
      path: r.path as string,
      snapshot: snap && roadmap ? { roadmap, fetchedAt: snap.fetchedAt } : null,
      links: links.filter((l) => l.remote === r.remote).map(({ remote: _remote, ...l }) => l),
      openTasks,
    };
  });
}
