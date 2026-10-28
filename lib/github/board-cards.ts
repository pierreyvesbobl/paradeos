import "server-only";

import {
  type IssueTaskLink,
  listIssueTaskLinks,
  type SyncedRepo,
} from "@/lib/db/queries/issue-board";
import { listBoardIssues } from "@/lib/github/board";
import type { BoardIssue } from "@/lib/github/issue-board";
import { parseGithubRepo } from "@/lib/github/remote";

export type BoardCard = {
  issue: BoardIssue;
  repo: SyncedRepo;
  /** La tâche Parade OS projetée dans cette issue, s'il y en a une. */
  task: IssueTaskLink | null;
};

export type BoardLoad = {
  /** Dépôts GitHub effectivement interrogés. */
  repoCount: number;
  cards: BoardCard[];
  problems: { remote: string; message: string }[];
  noToken: boolean;
  pullRequestsUnavailable: boolean;
};

/**
 * Les cartes du tableau pour une liste de dépôts suivis : issues lues
 * dépôt par dépôt, rapprochées des tâches Parade OS qui les ont créées.
 * Partagé par le tableau global (`/taches/issues`) et l'onglet
 * Développement de la fiche projet.
 */
export async function loadBoardCards(repos: SyncedRepo[]): Promise<BoardLoad> {
  const targets = repos
    .map((repo) => ({ repo, ref: parseGithubRepo(repo.remote) }))
    .filter((t): t is { repo: SyncedRepo; ref: { owner: string; repo: string } } => t.ref !== null);

  const [results, links] = await Promise.all([
    Promise.all(targets.map(async (t) => ({ ...t, result: await listBoardIssues(t.ref) }))),
    listIssueTaskLinks(targets.map((t) => t.repo.remote)),
  ]);
  const linkByKey = new Map(links.map((l) => [`${l.remote}#${l.number}`, l]));

  const load: BoardLoad = {
    repoCount: targets.length,
    cards: [],
    problems: [],
    noToken: false,
    pullRequestsUnavailable: false,
  };
  for (const r of results) {
    if (r.result.status === "no_token") {
      load.noToken = true;
      continue;
    }
    if (r.result.status === "error") {
      load.problems.push({ remote: r.repo.remote, message: r.result.message });
      continue;
    }
    if (r.result.pullRequestsUnavailable) load.pullRequestsUnavailable = true;
    for (const issue of r.result.issues) {
      load.cards.push({
        issue,
        repo: r.repo,
        task: linkByKey.get(`${r.repo.remote}#${issue.number}`) ?? null,
      });
    }
  }
  return load;
}
