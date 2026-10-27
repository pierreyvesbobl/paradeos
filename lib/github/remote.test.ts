import { describe, expect, it } from "vitest";
import { parseGithubRepo } from "./remote";

describe("parseGithubRepo", () => {
  it("lit owner et repo d'un remote github.com normalisé", () => {
    expect(parseGithubRepo("github.com/pierreyvesbobl/gpasplus-channel-health")).toEqual({
      owner: "pierreyvesbobl",
      repo: "gpasplus-channel-health",
    });
  });

  it("ignore ce qui n'est pas un dépôt GitHub à deux segments", () => {
    expect(parseGithubRepo("gitlab.com/parade/paradeos")).toBeNull();
    expect(parseGithubRepo("github.com/parade/groupe/paradeos")).toBeNull();
    expect(parseGithubRepo("local/paradeos")).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
  });
});
