"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { taskCommitLinks } from "@/db/schema/repo-commits";
import { tasks } from "@/db/schema/tasks";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { confirmCommitDelivers, rejectCommitLink, removeCommitLink } from "@/lib/repos/commits";
import { syncCommits } from "@/lib/repos/commits-sync";
import {
  decideCommitLinkSchema,
  linkTaskToCommitSchema,
  syncProjectCommitsSchema,
  unlinkTaskFromCommitSchema,
} from "@/lib/schemas/commits";

async function revalidateTask(taskId: string) {
  const conn = await db();
  const [row] = await conn
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  revalidatePath(`/taches/${taskId}`);
  if (row?.projectId) revalidatePath(`/projets/${row.projectId}`);
}

/** Tranche une suggestion : confirmer termine la tâche, refuser écarte la paire. */
export const decideCommitLink = action(decideCommitLinkSchema, async ({ input }) => {
  const conn = await db();
  const [link] = await conn
    .select({
      taskId: taskCommitLinks.taskId,
      remote: taskCommitLinks.remote,
      sha: taskCommitLinks.sha,
    })
    .from(taskCommitLinks)
    .where(eq(taskCommitLinks.id, input.id))
    .limit(1);
  if (!link) throw new Error("Suggestion introuvable.");
  let statusChanged = false;
  if (input.decision === "confirm") {
    statusChanged = await confirmCommitDelivers(conn, link);
  } else {
    await rejectCommitLink(conn, input.id);
  }
  await revalidateTask(link.taskId);
  return { taskId: link.taskId, statusChanged };
});

/** Liaison manuelle : ce commit livre cette tâche. */
export const linkTaskToCommit = action(linkTaskToCommitSchema, async ({ input }) => {
  const conn = await db();
  const statusChanged = await confirmCommitDelivers(conn, input);
  await revalidateTask(input.taskId);
  return { statusChanged };
});

/** Retire un lien ; la tâche garde son statut. */
export const unlinkTaskFromCommit = action(unlinkTaskFromCommitSchema, async ({ input }) => {
  const conn = await db();
  await removeCommitLink(conn, input);
  await revalidateTask(input.taskId);
  return { taskId: input.taskId };
});

/** Relit les commits GitHub des dépôts suivis du projet et rapproche. */
export const syncProjectCommits = action(syncProjectCommitsSchema, async ({ input }) => {
  const conn = await db();
  const results = await syncCommits(conn, input.projectId);
  revalidatePath(`/projets/${input.projectId}`);
  return results;
});
