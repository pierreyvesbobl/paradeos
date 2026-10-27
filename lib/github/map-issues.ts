export type GithubIssue = {
  number: number;
  title: string;
  htmlUrl: string;
  labels: string[];
  assignees: string[];
  comments: number;
  createdAt: string;
  updatedAt: string;
};

export type RawGithubIssue = {
  number: number;
  title: string;
  html_url: string;
  /** Présent quand la ligne est en fait une pull request. */
  pull_request?: unknown;
  labels?: ({ name?: string } | string)[];
  assignees?: { login?: string }[];
  comments?: number;
  created_at: string;
  updated_at: string;
};

/**
 * La réponse brute de `GET /repos/{owner}/{repo}/issues` ramenée à ce que
 * la fiche projet affiche. L'API mêle issues et pull requests sous la même
 * route : les PR sont écartées. Pure.
 */
export function mapIssues(raw: RawGithubIssue[]): GithubIssue[] {
  return raw
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      htmlUrl: i.html_url,
      labels: (i.labels ?? [])
        .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
        .filter((n) => n.length > 0),
      assignees: (i.assignees ?? []).map((a) => a.login ?? "").filter((l) => l.length > 0),
      comments: i.comments ?? 0,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    }));
}
