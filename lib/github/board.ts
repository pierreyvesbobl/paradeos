import "server-only";

import {
  BOARD_CLOSED_WINDOW_DAYS,
  BOARD_QUERY,
  type BoardIssue,
  mapBoardIssues,
  type RawBoardIssueNode,
} from "@/lib/github/issue-board";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export type BoardResult =
  | {
      status: "ok";
      issues: BoardIssue[];
      /** Le jeton n'a pas « Pull requests : lecture » : colonnes sans PR. */
      pullRequestsUnavailable: boolean;
    }
  | { status: "no_token" }
  | { status: "error"; message: string };

const CACHE_TTL_MS = 2 * 60_000;
const okCache = new Map<string, { at: number; result: Extract<BoardResult, { status: "ok" }> }>();

type GraphqlResponse = {
  data?: {
    repository?: {
      open?: { nodes?: (RawBoardIssueNode | null)[] | null } | null;
      closed?: { nodes?: (RawBoardIssueNode | null)[] | null } | null;
    } | null;
  } | null;
  errors?: { message?: string; path?: (string | number)[]; type?: string }[];
};

/**
 * Issues d'un dépôt pour le tableau : ouvertes, et fermées depuis
 * `BOARD_CLOSED_WINDOW_DAYS` jours, avec leurs PR liées. Même politique de
 * cache que `listOpenIssues` : seules les lectures réussies sont gardées.
 */
export async function listBoardIssues(ref: { owner: string; repo: string }): Promise<BoardResult> {
  const token = await getSetting(SETTING_KEYS.GITHUB_TOKEN);
  if (!token) return { status: "no_token" };

  const cacheKey = `${ref.owner}/${ref.repo}`.toLowerCase();
  const cached = okCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const since = new Date(Date.now() - BOARD_CLOSED_WINDOW_DAYS * 86_400_000).toISOString();
  let res: Response;
  try {
    res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: BOARD_QUERY,
        variables: { owner: ref.owner, repo: ref.repo, since },
      }),
      cache: "no-store",
    });
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "GitHub injoignable.",
    };
  }
  if (!res.ok) {
    return {
      status: "error",
      message: res.status === 401 ? "Jeton GitHub refusé." : `GitHub a répondu ${res.status}.`,
    };
  }

  const body = (await res.json()) as GraphqlResponse;
  const repository = body.data?.repository;
  if (!repository) {
    const first = body.errors?.[0]?.message;
    return {
      status: "error",
      message:
        body.errors?.some((e) => e.type === "NOT_FOUND") || !first
          ? "Dépôt introuvable ou jeton sans accès à ce dépôt."
          : first,
    };
  }
  const pullRequestsUnavailable =
    body.errors?.some((e) => e.path?.includes("closedByPullRequestsReferences")) ?? false;
  const issues = mapBoardIssues([
    ...(repository.open?.nodes ?? []),
    ...(repository.closed?.nodes ?? []),
  ]);
  const result = { status: "ok" as const, issues, pullRequestsUnavailable };
  okCache.set(cacheKey, { at: Date.now(), result });
  return result;
}
