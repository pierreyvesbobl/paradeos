"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { projectRepos } from "@/db/schema/project-repos";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { normalizeGitRemote } from "@/lib/git/remote";
import { addProjectRepoSchema, removeProjectRepoSchema } from "@/lib/schemas/project-repos";

export const addProjectRepo = action(addProjectRepoSchema, async ({ input, user }) => {
  const remote = normalizeGitRemote(input.remote);
  if (!remote) {
    throw new Error("Remote illisible. Attendu : git@github.com:owner/repo.git ou https://….");
  }
  const conn = await db();
  // Un dépôt n'appartient qu'à un projet : si déjà pris, on le déplace.
  const [row] = await conn
    .insert(projectRepos)
    .values({ projectId: input.projectId, remote, createdBy: user.id })
    .onConflictDoUpdate({
      target: projectRepos.remote,
      set: { projectId: input.projectId, createdBy: user.id, createdAt: new Date() },
    })
    .returning({ id: projectRepos.id, remote: projectRepos.remote });
  revalidatePath(`/projets/${input.projectId}`);
  return row;
});

export const removeProjectRepo = action(removeProjectRepoSchema, async ({ input }) => {
  const conn = await db();
  const [row] = await conn
    .delete(projectRepos)
    .where(eq(projectRepos.id, input.id))
    .returning({ projectId: projectRepos.projectId });
  if (row) revalidatePath(`/projets/${row.projectId}`);
  return { id: input.id };
});
