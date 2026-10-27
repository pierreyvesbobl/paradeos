import "server-only";

import { and, eq } from "drizzle-orm";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { taskGithubIssues } from "@/db/schema/task-github-issues";
import { tasks } from "@/db/schema/tasks";
import { getAppUrl } from "@/lib/app-url";
import { getTaskSources } from "@/lib/db/queries/task-sources";
import { db } from "@/lib/db/server";
import { buildIssueBrief } from "@/lib/github/issue-brief";
import { parseGithubRepo } from "@/lib/github/remote";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export type ProjectIssueResult =
  | { status: "created" | "updated" | "unchanged"; url: string; number: number }
  | {
      status: "skipped";
      reason: "not_feature" | "no_repo" | "no_token" | "task_missing";
    }
  | { status: "error"; message: string };

/** Libellé posé sur les issues nées d'une tâche, pour les filtrer côté GitHub. */
export const PARADEOS_ISSUE_LABEL = "paradeos";

const GITHUB_HEADERS = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

/**
 * Projette une tâche en issue GitHub, à sens unique : Parade OS possède le
 * titre et le brief, GitHub ne possède que la fermeture. Ne fait rien si la
 * tâche n'est pas une `feature` ou si aucun dépôt du projet n'a la
 * projection activée. Crée l'issue la première fois, la met à jour ensuite
 * si le brief a changé (empreinte), la laisse telle quelle sinon.
 */
export async function projectTaskToIssue(taskId: string): Promise<ProjectIssueResult> {
  const conn = await db();
  const [row] = await conn
    .select({ task: tasks, projectName: projects.name })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) return { status: "skipped", reason: "task_missing" };
  const { task, projectName } = row;
  if (task.kind !== "feature") return { status: "skipped", reason: "not_feature" };
  if (!task.projectId) return { status: "skipped", reason: "no_repo" };

  const [existing] = await conn
    .select()
    .from(taskGithubIssues)
    .where(eq(taskGithubIssues.taskId, taskId))
    .limit(1);

  // Le dépôt cible : celui de l'issue déjà ouverte, sinon le premier dépôt
  // GitHub du projet dont la projection est activée.
  let remote = existing?.remote ?? null;
  if (!remote) {
    const repoRows = await conn
      .select({ remote: projectRepos.remote })
      .from(projectRepos)
      .where(and(eq(projectRepos.projectId, task.projectId), eq(projectRepos.syncIssues, true)));
    remote = repoRows.map((r) => r.remote).find((r) => parseGithubRepo(r) !== null) ?? null;
  }
  const ref = parseGithubRepo(remote);
  if (!remote || !ref) return { status: "skipped", reason: "no_repo" };

  const token = await getSetting(SETTING_KEYS.GITHUB_TOKEN);
  if (!token) return { status: "skipped", reason: "no_token" };

  const [sources, appUrl] = await Promise.all([getTaskSources(taskId), getAppUrl()]);
  const brief = buildIssueBrief({
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
    },
    project: projectName ? { name: projectName } : null,
    sources,
    appUrl,
  });

  if (existing && existing.bodyFingerprint === brief.fingerprint) {
    return { status: "unchanged", url: existing.url, number: existing.number };
  }

  const base = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues`;
  const headers = GITHUB_HEADERS(token);
  try {
    if (existing) {
      const res = await fetch(`${base}/${existing.number}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ title: brief.title, body: brief.body }),
      });
      if (!res.ok) return { status: "error", message: await describeFailure(res) };
      await conn
        .update(taskGithubIssues)
        .set({ bodyFingerprint: brief.fingerprint, updatedAt: new Date() })
        .where(eq(taskGithubIssues.taskId, taskId));
      return { status: "updated", url: existing.url, number: existing.number };
    }

    let res = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: brief.title,
        body: brief.body,
        labels: [PARADEOS_ISSUE_LABEL],
      }),
    });
    // Un dépôt où le jeton ne peut pas créer le libellé : on crée sans.
    if (res.status === 422) {
      res = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: brief.title, body: brief.body }),
      });
    }
    if (!res.ok) return { status: "error", message: await describeFailure(res) };
    const created = (await res.json()) as { number: number; html_url: string };
    await conn
      .insert(taskGithubIssues)
      .values({
        taskId,
        remote,
        number: created.number,
        url: created.html_url,
        bodyFingerprint: brief.fingerprint,
      })
      .onConflictDoUpdate({
        target: taskGithubIssues.taskId,
        set: {
          remote,
          number: created.number,
          url: created.html_url,
          bodyFingerprint: brief.fingerprint,
          updatedAt: new Date(),
        },
      });
    return { status: "created", url: created.html_url, number: created.number };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "GitHub injoignable.",
    };
  }
}

async function describeFailure(res: Response): Promise<string> {
  if (res.status === 401) return "Jeton GitHub refusé.";
  if (res.status === 403) {
    return "Le jeton n'a pas la permission « Issues : lecture et écriture » sur ce dépôt.";
  }
  if (res.status === 404) return "Dépôt introuvable ou jeton sans accès à ce dépôt.";
  let detail = "";
  try {
    detail = ((await res.json()) as { message?: string }).message ?? "";
  } catch {}
  return `GitHub a répondu ${res.status}${detail ? ` : ${detail}` : "."}`;
}

/**
 * Même chose, sans jamais faire échouer l'appelant : l'acceptation d'une
 * proposition ou un changement de type ne doivent pas dépendre de GitHub.
 */
export async function projectTaskToIssueQuietly(taskId: string): Promise<void> {
  try {
    const result = await projectTaskToIssue(taskId);
    if (result.status === "error") {
      console.warn(`[github issue] tâche ${taskId} : ${result.message}`);
    } else if (result.status === "created" || result.status === "updated") {
      console.info(`[github issue] tâche ${taskId} : issue #${result.number} ${result.status}.`);
    }
  } catch (err) {
    console.warn(`[github issue] tâche ${taskId} :`, err);
  }
}
