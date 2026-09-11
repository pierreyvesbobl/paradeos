import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("accepte un chemin relatif à l'origine", () => {
    expect(safeNextPath("/projets/42?tab=notes")).toBe("/projets/42?tab=notes");
    expect(safeNextPath("/")).toBe("/");
  });

  it("retombe sur l'accueil pour tout ce qui pourrait sortir de l'origine", () => {
    expect(safeNextPath("//evil.tld/phish")).toBe("/");
    expect(safeNextPath("/\\evil.tld")).toBe("/");
    expect(safeNextPath("https://evil.tld")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("evil.tld")).toBe("/");
  });

  it("retombe sur le fallback quand next est absent", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined, "/inbox")).toBe("/inbox");
    expect(safeNextPath("", "/inbox")).toBe("/inbox");
  });
});
