import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { type CommitSource, repoCommits, taskCommitLinks } from "@/db/schema/repo-commits";
import { markTaskDone } from "@/lib/tasks/complete";

/**
 * Écritures sur les commits, partagées entre le cron (GitHub), le serveur
 * MCP (mod Claude Code) et les Server Actions. Pas de `server-only` : le
 * serveur MCP stdio tourne sous tsx.
 */

type Conn = Pick<Database, "select" | "insert" | "update" | "delete">;

export type IncomingCommit = {
  sha: string;
  subject: string;
  body?: string | null;
  author?: string | null;
  committedAt: string | Date;
  url?: string | null;
};

/** Insère les commits inconnus ; renvoie combien l'étaient. Idempotent par (remote, sha). */
export async function upsertCommits(
  conn: Conn,
  remote: string,
  commits: readonly IncomingCommit[],
  source: CommitSource,
): Promise<number> {
  const clean = commits
    .map((c) => ({
      remote,
      sha: c.sha.trim(),
      subject: c.subject.trim().slice(0, 500) || "(sans message)",
      body: c.body?.trim() ? c.body.trim().slice(0, 5000) : null,
      author: c.author?.trim() || null,
      committedAt: new Date(c.committedAt),
      url: c.url ?? null,
      source,
    }))
    .filter((c) => /^[0-9a-f]{7,64}$/i.test(c.sha) && !Number.isNaN(c.committedAt.getTime()));
  if (clean.length === 0) return 0;
  const inserted = await conn
    .insert(repoCommits)
    .values(clean)
    .onConflictDoNothing({ target: [repoCommits.remote, repoCommits.sha] })
    .returning({ id: repoCommits.id });
  return inserted.length;
}

/**
 * Confirme qu'un commit livre une tâche : le lien passe `confirmed` et la
 * tâche est terminée (un commit sur la branche principale, c'est livré).
 * Renvoie vrai si le statut de la tâche a changé.
 */
export async function confirmCommitDelivers(
  conn: Conn,
  link: { taskId: string; remote: string; sha: string },
): Promise<boolean> {
  await conn
    .insert(taskCommitLinks)
    .values({ ...link, status: "confirmed", decidedAt: new Date() })
    .onConflictDoUpdate({
      target: [taskCommitLinks.taskId, taskCommitLinks.remote, taskCommitLinks.sha],
      set: { status: "confirmed", decidedAt: new Date() },
    });
  const snapshot = await markTaskDone(conn, link.taskId);
  return snapshot?.changed ?? false;
}

export async function rejectCommitLink(conn: Conn, id: string): Promise<void> {
  await conn
    .update(taskCommitLinks)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(eq(taskCommitLinks.id, id));
}

export async function removeCommitLink(
  conn: Conn,
  link: { taskId: string; remote: string; sha: string },
): Promise<void> {
  await conn
    .delete(taskCommitLinks)
    .where(
      and(
        eq(taskCommitLinks.taskId, link.taskId),
        eq(taskCommitLinks.remote, link.remote),
        eq(taskCommitLinks.sha, link.sha),
      ),
    );
}
