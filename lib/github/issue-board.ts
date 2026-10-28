/**
 * Tableau des issues GitHub (`/taches/issues`). Les colonnes ne sont pas
 * un état stocké côté Parade OS : elles se déduisent de ce que GitHub dit
 * de chaque issue (PR liée, assignation, fermeture). Pure.
 */

export const BOARD_COLUMNS = ["todo", "in_progress", "in_review", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const boardColumnLabels: Record<BoardColumn, string> = {
  todo: "À développer",
  in_progress: "En cours",
  in_review: "En revue",
  done: "Livrées",
};

export const boardColumnHints: Record<BoardColumn, string> = {
  todo: "Ouverte, personne dessus, aucune PR.",
  in_progress: "Assignée, ou PR brouillon liée.",
  in_review: "Une PR liée est ouverte et prête.",
  done: "Fermée ces dernières semaines.",
};

export type BoardTint = "gray" | "blue" | "yellow" | "green";

export const boardColumnTints: Record<BoardColumn, BoardTint> = {
  todo: "gray",
  in_progress: "blue",
  in_review: "yellow",
  done: "green",
};

/** Fenêtre des issues fermées montrées dans « Livrées ». */
export const BOARD_CLOSED_WINDOW_DAYS = 30;

export type BoardPullRequest = {
  number: number;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
};

export type BoardIssue = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  closedAt: string | null;
  updatedAt: string;
  labels: string[];
  assignees: string[];
  comments: number;
  pullRequests: BoardPullRequest[];
};

/** Un nœud `Issue` tel que renvoyé par la requête `BOARD_QUERY`. */
export type RawBoardIssueNode = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  closedAt: string | null;
  updatedAt: string;
  labels?: { nodes?: ({ name?: string | null } | null)[] | null } | null;
  assignees?: { nodes?: ({ login?: string | null } | null)[] | null } | null;
  comments?: { totalCount?: number | null } | null;
  /** Null quand le jeton n'a pas « Pull requests : lecture ». */
  closedByPullRequestsReferences?: {
    nodes?:
      | ({
          number: number;
          url: string;
          isDraft?: boolean | null;
          state?: string | null;
        } | null)[]
      | null;
  } | null;
};

/**
 * Une requête par dépôt : les issues ouvertes et celles fermées depuis
 * `since`, avec les PR qui les référencent (« closes #n » ou liaison
 * manuelle). Les PR sont un champ à part dans les permissions du jeton :
 * sans elle, GitHub renvoie ce champ à null et une erreur à côté, le
 * reste du tableau reste exploitable.
 */
export const BOARD_QUERY = `
query Board($owner: String!, $repo: String!, $since: DateTime!) {
  repository(owner: $owner, name: $repo) {
    open: issues(first: 50, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...IssueFields }
    }
    closed: issues(first: 20, states: [CLOSED], filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...IssueFields }
    }
  }
}
fragment IssueFields on Issue {
  number title url state closedAt updatedAt
  labels(first: 10) { nodes { name } }
  assignees(first: 5) { nodes { login } }
  comments { totalCount }
  closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
    nodes { number url isDraft state }
  }
}`;

function prState(raw: string | null | undefined): BoardPullRequest["state"] {
  return raw === "MERGED" || raw === "CLOSED" ? raw : "OPEN";
}

export function mapBoardIssues(nodes: (RawBoardIssueNode | null)[]): BoardIssue[] {
  const out: BoardIssue[] = [];
  for (const n of nodes) {
    if (!n) continue;
    out.push({
      number: n.number,
      title: n.title,
      url: n.url,
      state: n.state === "CLOSED" ? "closed" : "open",
      closedAt: n.closedAt ?? null,
      updatedAt: n.updatedAt,
      labels: (n.labels?.nodes ?? []).map((l) => l?.name ?? "").filter((name) => name.length > 0),
      assignees: (n.assignees?.nodes ?? [])
        .map((a) => a?.login ?? "")
        .filter((login) => login.length > 0),
      comments: n.comments?.totalCount ?? 0,
      pullRequests: (n.closedByPullRequestsReferences?.nodes ?? [])
        .filter((pr): pr is NonNullable<typeof pr> => pr !== null)
        .map((pr) => ({
          number: pr.number,
          url: pr.url,
          isDraft: pr.isDraft === true,
          state: prState(pr.state),
        })),
    });
  }
  return out;
}

/**
 * Colonne d'une issue. Une PR ouverte et prête l'emporte sur tout le
 * reste : c'est le signal « il y a du code à relire ». Une PR brouillon ou
 * une assignation disent « quelqu'un est dessus ». Les PR fusionnées ou
 * fermées ne comptent plus : si l'issue est encore ouverte, elle revient
 * à développer.
 */
export function columnOf(issue: BoardIssue): BoardColumn {
  if (issue.state === "closed") return "done";
  const openPrs = issue.pullRequests.filter((pr) => pr.state === "OPEN");
  if (openPrs.some((pr) => !pr.isDraft)) return "in_review";
  if (openPrs.length > 0 || issue.assignees.length > 0) return "in_progress";
  return "todo";
}

export function groupByColumn<T extends { issue: BoardIssue }>(
  cards: T[],
): Record<BoardColumn, T[]> {
  const groups: Record<BoardColumn, T[]> = {
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
  };
  for (const card of cards) groups[columnOf(card.issue)].push(card);
  return groups;
}
