"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { projectRepos } from "@/db/schema/project-repos";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { normalizeGitRemote } from "@/lib/git/remote";
import { linkRemote } from "@/lib/repos/link";
import { addProjectRepoSchema, removeProjectRepoSchema } from "@/lib/schemas/project-repos";

export const addProjectRepo = action(addProjectRepoSchema, async ({ input, user }) => {
  const remote = normalizeGitRemote(input.remote);
  if (!remote) {
    throw new Error("Remote illisible. Attendu : git@github.com:owner/repo.git ou https://….");
  }
  const conn = await db();
  // Un dépôt n'appartient qu'à un projet : si déjà pris, on le déplace.
  // L'activité Claude Code déjà poussée sous ce remote est imputée au passage.
  const row = await linkRemote(conn, {
    remote,
    projectId: input.projectId,
    userId: user.id,
    auto: false,
  });
  revalidatePath(`/projets/${input.projectId}`);
  revalidatePath("/temps");
  return row;
});

export const removeProjectRepo = action(removeProjectRepoSchema, async ({ input }) => {
  const conn = await db();
  const [row] = await conn
    .delete(projectRepos)
    .where(eq(projectRepos.id, input.id))
    .returning({ projectId: projectRepos.projectId });
  if (row) revalidatePath(`/projets/${row.projectId}`);
  revalidatePath("/temps");
  return { id: input.id };
});
