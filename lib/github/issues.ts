import "server-only";

import { type GithubIssue, mapIssues, type RawGithubIssue } from "@/lib/github/map-issues";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export type { GithubIssue } from "@/lib/github/map-issues";

export type GithubIssuesResult =
  | { status: "ok"; issues: GithubIssue[] }
  | { status: "no_token" }
  | { status: "error"; httpStatus: number | null; message: string };

/** Dernière lecture réussie par dépôt, gardée deux minutes par instance. */
const CACHE_TTL_MS = 2 * 60_000;
const okCache = new Map<string, { at: number; issues: GithubIssue[] }>();

/**
 * Issues ouvertes d'un dépôt, lues avec le jeton du réglage `GITHUB_TOKEN`.
 * L'API mêle issues et pull requests sous la même route : les PR sont
 * écartées. Seules les lectures réussies sont gardées en mémoire (deux
 * minutes) : une erreur n'est jamais mise en cache, un jeton corrigé prend
 * effet au rendu suivant.
 */
export async function listOpenIssues(ref: {
  owner: string;
  repo: string;
}): Promise<GithubIssuesResult> {
  const token = await getSetting(SETTING_KEYS.GITHUB_TOKEN);
  if (!token) return { status: "no_token" };

  const cacheKey = `${ref.owner}/${ref.repo}`.toLowerCase();
  const cached = okCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { status: "ok", issues: cached.issues };
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues?state=open&per_page=50&sort=updated`;
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
          ? "Le jeton voit le dépôt mais n'a pas la permission « Issues : lecture »."
          : res.status === 404
            ? "Dépôt introuvable ou jeton sans accès à ce dépôt."
            : `GitHub a répondu ${res.status}.`;
    return { status: "error", httpStatus: res.status, message };
  }
  const raw = (await res.json()) as RawGithubIssue[];
  const issues = mapIssues(raw);
  okCache.set(cacheKey, { at: Date.now(), issues });
  return { status: "ok", issues };
}
