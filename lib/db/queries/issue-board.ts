import { asc, eq, inArray } from "drizzle-orm";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { taskGithubIssues } from "@/db/schema/task-github-issues";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";

export type SyncedRepo = {
  remote: string;
  projectId: string;
  projectName: string;
  projectColor: string | null;
};

/** Les dépôts dont la case « Issues » est cochée sur une fiche projet. */
export async function listSyncedRepos(): Promise<SyncedRepo[]> {
  const conn = await db();
  return conn
    .select({
      remote: projectRepos.remote,
      projectId: projects.id,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(projectRepos)
    .innerJoin(projects, eq(projectRepos.projectId, projects.id))
    .where(eq(projectRepos.syncIssues, true))
    .orderBy(asc(projects.name), asc(projectRepos.remote));
}

export type IssueTaskLink = {
  remote: string;
  number: number;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
};

/** Les tâches Parade OS derrière les issues de ces dépôts. */
export async function listIssueTaskLinks(remotes: readonly string[]): Promise<IssueTaskLink[]> {
  if (remotes.length === 0) return [];
  const conn = await db();
  return conn
    .select({
      remote: taskGithubIssues.remote,
      number: taskGithubIssues.number,
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskStatus: tasks.status,
    })
    .from(taskGithubIssues)
    .innerJoin(tasks, eq(taskGithubIssues.taskId, tasks.id))
    .where(inArray(taskGithubIssues.remote, [...remotes]));
}
