import "server-only";

import { getSetting, SETTING_KEYS } from "@/lib/settings";

export type GithubCommit = {
  sha: string;
  subject: string;
  body: string | null;
  author: string | null;
  committedAt: string;
  url: string;
};

export type GithubCommitsResult =
  | { status: "ok"; commits: GithubCommit[] }
  | { status: "no_token" }
  | { status: "error"; httpStatus: number | null; message: string };

/**
 * Les commits de la branche par défaut depuis `since` (au plus 100), avec
 * le jeton `GITHUB_TOKEN`. Demande « Contents : lecture ». Sujet et corps
 * sont séparés à la première ligne vide, comme git le fait.
 */
export async function listCommitsSince(
  ref: { owner: string; repo: string },
  since: Date,
): Promise<GithubCommitsResult> {
  const token = await getSetting(SETTING_KEYS.GITHUB_TOKEN);
  if (!token) return { status: "no_token" };
  const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/commits?since=${encodeURIComponent(since.toISOString())}&per_page=100`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
  } catch (err) {
    return {
      status: "error",
      httpStatus: null,
      message: err instanceof Error ? err.message : "GitHub injoignable.",
    };
  }
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Jeton GitHub refusé."
        : res.status === 403
          ? "Le jeton voit le dépôt mais n'a pas la permission « Contents : lecture »."
          : res.status === 404
            ? "Dépôt introuvable ou jeton sans « Contents : lecture » sur ce dépôt."
            : res.status === 409
              ? "Dépôt vide."
              : `GitHub a répondu ${res.status}.`;
    return { status: "error", httpStatus: res.status, message };
  }
  const raw = (await res.json()) as {
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author?: { name?: string | null; date?: string | null } | null;
      committer?: { date?: string | null } | null;
    };
  }[];
  return {
    status: "ok",
    commits: raw.map((c) => {
      const [subject, ...rest] = c.commit.message.split("\n");
      const body = rest.join("\n").trim();
      return {
        sha: c.sha,
        subject: (subject ?? "").trim() || "(sans message)",
        body: body.length > 0 ? body : null,
        author: c.commit.author?.name ?? null,
        committedAt: c.commit.author?.date ?? c.commit.committer?.date ?? new Date().toISOString(),
        url: c.html_url,
      };
    }),
  };
}
