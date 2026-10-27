import { asc, eq } from "drizzle-orm";
import { projectRepos } from "@/db/schema/project-repos";
import { db } from "@/lib/db/server";
import { listOpenProjects, rankProjects } from "@/lib/repos/link";

export type ProjectRepoRow = {
  id: string;
  remote: string;
  autoLinked: boolean;
  /** Projection des tâches `feature` en issues GitHub activée. */
  syncIssues: boolean;
  createdAt: Date;
};

export async function getProjectRepos(projectId: string): Promise<ProjectRepoRow[]> {
  const conn = await db();
  return conn
    .select({
      id: projectRepos.id,
      remote: projectRepos.remote,
      autoLinked: projectRepos.autoLinked,
      syncIssues: projectRepos.syncIssues,
      createdAt: projectRepos.createdAt,
    })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId))
    .orderBy(asc(projectRepos.createdAt));
}

export type RepoLinkChoice = {
  remote: string;
  /** Projets ouverts, les candidats par affinité de nom d'abord. */
  options: { id: string; name: string; suggested: boolean }[];
};

/** Pour chaque dépôt non rattaché, les projets à proposer dans /temps. */
export async function getRepoLinkChoices(remotes: readonly string[]): Promise<RepoLinkChoice[]> {
  if (remotes.length === 0) return [];
  const open = await listOpenProjects(await db());
  return remotes.map((remote) => {
    const ranked = rankProjects(remote, open);
    const suggested = new Set(ranked.map((c) => c.id));
    const sorted = [
      ...ranked.map((c) => ({ id: c.id, name: c.name, suggested: true })),
      ...open.filter((p) => !suggested.has(p.id)).map((p) => ({ ...p, suggested: false })),
    ];
    return { remote, options: sorted };
  });
}
