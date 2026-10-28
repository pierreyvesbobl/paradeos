import { describe, expect, it } from "vitest";
import {
  type BoardIssue,
  columnOf,
  groupByColumn,
  mapBoardIssues,
  type RawBoardIssueNode,
} from "./issue-board";

function issue(partial: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number: 1,
    title: "Alertes email",
    url: "https://github.com/o/r/issues/1",
    state: "open",
    closedAt: null,
    updatedAt: "2026-10-27T16:40:01Z",
    labels: [],
    assignees: [],
    comments: 0,
    pullRequests: [],
    ...partial,
  };
}

describe("mapBoardIssues", () => {
  it("aplatit les connexions GraphQL et tolère les nœuds nuls", () => {
    const nodes: (RawBoardIssueNode | null)[] = [
      null,
      {
        number: 1,
        title: "Alertes email",
        url: "https://github.com/o/r/issues/1",
        state: "OPEN",
        closedAt: null,
        updatedAt: "2026-10-27T16:40:01Z",
        labels: { nodes: [{ name: "paradeos" }, null, { name: "" }] },
        assignees: { nodes: [{ login: "py" }] },
        comments: { totalCount: 2 },
        closedByPullRequestsReferences: {
          nodes: [
            { number: 4, url: "https://github.com/o/r/pull/4", isDraft: true, state: "OPEN" },
          ],
        },
      },
    ];
    expect(mapBoardIssues(nodes)).toEqual([
      issue({
        labels: ["paradeos"],
        assignees: ["py"],
        comments: 2,
        pullRequests: [
          { number: 4, url: "https://github.com/o/r/pull/4", isDraft: true, state: "OPEN" },
        ],
      }),
    ]);
  });

  it("sans permission Pull requests, le champ nul donne une liste vide", () => {
    const [mapped] = mapBoardIssues([
      {
        number: 2,
        title: "Fermée",
        url: "https://github.com/o/r/issues/2",
        state: "CLOSED",
        closedAt: "2026-10-20T10:00:00Z",
        updatedAt: "2026-10-20T10:00:00Z",
        closedByPullRequestsReferences: null,
      },
    ]);
    expect(mapped?.pullRequests).toEqual([]);
    expect(mapped?.state).toBe("closed");
    expect(mapped?.closedAt).toBe("2026-10-20T10:00:00Z");
  });
});

describe("columnOf", () => {
  const pr = (state: "OPEN" | "MERGED" | "CLOSED", isDraft = false) => ({
    number: 9,
    url: "https://github.com/o/r/pull/9",
    isDraft,
    state,
  });

  it("ouverte sans signal : à développer", () => {
    expect(columnOf(issue())).toBe("todo");
  });
  it("assignée : en cours", () => {
    expect(columnOf(issue({ assignees: ["py"] }))).toBe("in_progress");
  });
  it("PR brouillon liée : en cours, même sans assigné", () => {
    expect(columnOf(issue({ pullRequests: [pr("OPEN", true)] }))).toBe("in_progress");
  });
  it("PR ouverte prête : en revue, même assignée", () => {
    expect(columnOf(issue({ assignees: ["py"], pullRequests: [pr("OPEN")] }))).toBe("in_review");
  });
  it("PR fusionnée ou fermée mais issue encore ouverte : retour à développer", () => {
    expect(columnOf(issue({ pullRequests: [pr("MERGED"), pr("CLOSED")] }))).toBe("todo");
  });
  it("issue fermée : livrée, quel que soit le reste", () => {
    expect(
      columnOf(issue({ state: "closed", assignees: ["py"], pullRequests: [pr("OPEN")] })),
    ).toBe("done");
  });
});

describe("groupByColumn", () => {
  it("répartit les cartes et garde les quatre colonnes même vides", () => {
    const groups = groupByColumn([
      { issue: issue({ number: 1 }) },
      { issue: issue({ number: 2, assignees: ["py"] }) },
    ]);
    expect(groups.todo.map((c) => c.issue.number)).toEqual([1]);
    expect(groups.in_progress.map((c) => c.issue.number)).toEqual([2]);
    expect(groups.in_review).toEqual([]);
    expect(groups.done).toEqual([]);
  });
});
