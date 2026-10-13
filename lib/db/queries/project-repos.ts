import { asc, eq } from "drizzle-orm";
import { projectRepos } from "@/db/schema/project-repos";
import { db } from "@/lib/db/server";

export type ProjectRepoRow = {
  id: string;
  remote: string;
  createdAt: Date;
};

export async function getProjectRepos(projectId: string): Promise<ProjectRepoRow[]> {
  const conn = await db();
  return conn
    .select({ id: projectRepos.id, remote: projectRepos.remote, createdAt: projectRepos.createdAt })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId))
    .orderBy(asc(projectRepos.createdAt));
}
