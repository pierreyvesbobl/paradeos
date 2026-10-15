import { describe, expect, it } from "vitest";
import {
  gitRemoteBasename,
  isLocalRepoKey,
  localRepoKey,
  normalizeGitRemote,
  repoKeyLabel,
} from "./remote";

describe("normalizeGitRemote", () => {
  it("ramène SSH, HTTPS et scp-like à la même clé", () => {
    const expected = "github.com/parade/paradeos";
    expect(normalizeGitRemote("git@github.com:parade/paradeos.git")).toBe(expected);
    expect(normalizeGitRemote("ssh://git@github.com/parade/paradeos.git")).toBe(expected);
    expect(normalizeGitRemote("https://github.com/parade/paradeos.git")).toBe(expected);
    expect(normalizeGitRemote("https://py@github.com/parade/paradeos/")).toBe(expected);
    expect(normalizeGitRemote("github.com/Parade/ParadeOS")).toBe("github.com/parade/paradeos");
  });

  it("ignore le port et garde les sous-chemins (GitLab groupes)", () => {
    expect(normalizeGitRemote("ssh://git@gitlab.com:2222/groupe/sous/repo.git")).toBe(
      "gitlab.com/groupe/sous/repo",
    );
  });

  it("refuse ce qui n'est pas un remote distant", () => {
    expect(normalizeGitRemote("")).toBeNull();
    expect(normalizeGitRemote(null)).toBeNull();
    expect(normalizeGitRemote("/Users/py/Dev/paradeos")).toBeNull();
    expect(normalizeGitRemote("file:///tmp/repo.git")).toBeNull();
    expect(normalizeGitRemote("github.com")).toBeNull();
  });

  it("extrait le nom du dépôt", () => {
    expect(gitRemoteBasename("github.com/parade/paradeos")).toBe("paradeos");
  });

  it("laisse passer la clé d'un dossier sans git, et la construit depuis un chemin", () => {
    expect(localRepoKey("/Users/py/Dev/Automato_MotionDesign/")).toBe(
      "local/automato_motiondesign",
    );
    expect(localRepoKey("C:\\Dev\\site")).toBe("local/site");
    expect(localRepoKey("/")).toBeNull();
    expect(localRepoKey(null)).toBeNull();
    expect(normalizeGitRemote("local/paradeos")).toBe("local/paradeos");
    expect(normalizeGitRemote("local/")).toBeNull();
    expect(isLocalRepoKey("local/paradeos")).toBe(true);
    expect(isLocalRepoKey("github.com/parade/paradeos")).toBe(false);
    expect(repoKeyLabel("local/paradeos")).toBe("dossier paradeos");
    expect(repoKeyLabel("github.com/parade/paradeos")).toBe("github.com/parade/paradeos");
  });
});
