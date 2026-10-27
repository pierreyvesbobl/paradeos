import { describe, expect, it } from "vitest";
import { mapIssues } from "./map-issues";

describe("mapIssues", () => {
  it("écarte les pull requests et aplatit labels et assignés", () => {
    const issues = mapIssues([
      {
        number: 12,
        title: "Alerte email suspension",
        html_url: "https://github.com/o/r/issues/12",
        labels: [{ name: "feature" }, "agent", { name: "" }],
        assignees: [{ login: "pierreyvesbobl" }, {}],
        comments: 2,
        created_at: "2026-10-20T10:00:00Z",
        updated_at: "2026-10-27T10:00:00Z",
      },
      {
        number: 13,
        title: "Une PR",
        html_url: "https://github.com/o/r/pull/13",
        pull_request: { url: "x" },
        created_at: "2026-10-21T10:00:00Z",
        updated_at: "2026-10-21T10:00:00Z",
      },
    ]);
    expect(issues).toEqual([
      {
        number: 12,
        title: "Alerte email suspension",
        htmlUrl: "https://github.com/o/r/issues/12",
        labels: ["feature", "agent"],
        assignees: ["pierreyvesbobl"],
        comments: 2,
        createdAt: "2026-10-20T10:00:00Z",
        updatedAt: "2026-10-27T10:00:00Z",
      },
    ]);
  });
});
