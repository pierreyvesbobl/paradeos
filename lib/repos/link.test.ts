import { describe, expect, it } from "vitest";
import { decideAutoLink, nameAffinity, rankProjects } from "./link";

describe("nameAffinity", () => {
  it("ignore casse, accents et séparateurs", () => {
    expect(nameAffinity("paradeos", "Parade OS")).toBe(3);
    expect(nameAffinity("studio-chanson", "Studio Chanson")).toBe(3);
    expect(nameAffinity("thermigo-landing", "Thermigo")).toBe(2);
    expect(nameAffinity("autoradio", "Autoradio v2")).toBe(2);
    expect(nameAffinity("site-vitrine-parade", "Refonte vitrine")).toBe(1);
    expect(nameAffinity("foo", "Bar")).toBe(0);
  });
});

describe("decideAutoLink", () => {
  const open = [
    { id: "a", name: "Thermigo" },
    { id: "b", name: "Thermigo v2" },
    { id: "c", name: "Parade OS" },
    { id: "d", name: "Refonte vitrine" },
  ];

  it("rattache quand un seul projet porte le nom", () => {
    const picked = decideAutoLink(rankProjects("git@github.com:parade/paradeos.git", open));
    expect(picked?.id).toBe("c");
  });

  it("hésite entre deux projets sérieux", () => {
    const ranked = rankProjects("https://github.com/parade/thermigo", open);
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
    expect(decideAutoLink(ranked)).toBeNull();
  });

  it("ne se contente pas d'un mot en commun", () => {
    const ranked = rankProjects("git@github.com:parade/site-vitrine-parade.git", open);
    expect(ranked[0]?.score).toBe(1);
    expect(decideAutoLink(ranked)).toBeNull();
  });

  it("ne propose rien pour un dépôt sans affinité", () => {
    expect(rankProjects("git@github.com:parade/zzz.git", open)).toEqual([]);
    expect(decideAutoLink([])).toBeNull();
  });
});
