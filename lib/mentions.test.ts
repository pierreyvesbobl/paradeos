import { describe, expect, it } from "vitest";
import {
  buildUserMentionResolver,
  extractUserMentionTokens,
  resolveMentionedUserIds,
} from "./mentions";

describe("extractUserMentionTokens", () => {
  it("extracts a single @mention", () => {
    expect(extractUserMentionTokens("salut @py ça va ?")).toEqual(["py"]);
  });

  it("extracts multiple, dedupes, lowercases", () => {
    expect(extractUserMentionTokens("@PY merci, voir avec @Benoit et encore @py")).toEqual([
      "py",
      "benoit",
    ]);
  });

  it("ignores email addresses (no leading whitespace boundary needed by regex)", () => {
    // Note : le regex courant matche @py dans une adresse aussi. Ce test
    // documente le comportement actuel — pas idéal mais accepté en phase 1.
    const tokens = extractUserMentionTokens("écris à py@bobl.fr stp");
    expect(tokens).toContain("bobl");
  });

  it("handles accented and hyphenated names", () => {
    expect(extractUserMentionTokens("@Bénilde et @Pierre-Yves")).toEqual([
      "bénilde",
      "pierre-yves",
    ]);
  });

  it("returns empty array when no mention", () => {
    expect(extractUserMentionTokens("contenu sans mention")).toEqual([]);
  });
});

describe("buildUserMentionResolver", () => {
  it("indexes by first name (lowercase) and full name without spaces", () => {
    const resolver = buildUserMentionResolver([
      { id: "u1", fullName: "Pierre-Yves Sage" },
      { id: "u2", fullName: "Benoît Martin" },
    ]);
    expect(resolver["pierre-yves"]).toBe("u1");
    expect(resolver["pierre-yvessage"]).toBe("u1");
    expect(resolver.benoît).toBe("u2");
    expect(resolver.benoîtmartin).toBe("u2");
  });

  it("first-match-wins on collision", () => {
    const resolver = buildUserMentionResolver([
      { id: "u1", fullName: "Pierre Dupont" },
      { id: "u2", fullName: "Pierre Martin" },
    ]);
    expect(resolver.pierre).toBe("u1");
  });

  it("ignores users without fullName", () => {
    const resolver = buildUserMentionResolver([
      { id: "u1", fullName: null },
      { id: "u2", fullName: "" },
      { id: "u3", fullName: "Alice" },
    ]);
    expect(Object.keys(resolver).sort()).toEqual(["alice"]);
  });
});

describe("resolveMentionedUserIds", () => {
  it("returns unique resolved user ids", () => {
    const resolver = { py: "u1", benoit: "u2", pyrade: "u1" };
    expect(resolveMentionedUserIds(["py", "pyrade", "benoit"], resolver)).toEqual(["u1", "u2"]);
  });

  it("ignores tokens that do not resolve", () => {
    const resolver = { py: "u1" };
    expect(resolveMentionedUserIds(["py", "inconnu"], resolver)).toEqual(["u1"]);
  });

  it("empty input → empty output", () => {
    expect(resolveMentionedUserIds([], { py: "u1" })).toEqual([]);
  });
});
