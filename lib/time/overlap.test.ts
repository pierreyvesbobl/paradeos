import { describe, expect, it } from "vitest";
import { creditOverlaps, rawMinutes } from "./overlap";

const m = (min: number) => min * 60_000;

describe("creditOverlaps", () => {
  it("laisse intact un créneau isolé", () => {
    const c = creditOverlaps([{ id: "a", startMs: 0, endMs: m(60) }]);
    expect(c.get("a")).toBe(60);
  });

  it("partage à parts égales la plage commune de deux sessions parallèles", () => {
    const c = creditOverlaps([
      { id: "a", startMs: 0, endMs: m(60) },
      { id: "b", startMs: m(30), endMs: m(90) },
    ]);
    // a : 30 min seul + 15 min partagées ; b : 15 partagées + 30 seul.
    expect(c.get("a")).toBe(45);
    expect(c.get("b")).toBe(45);
    const total = [...c.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(90);
  });

  it("divise par trois quand trois sessions se recouvrent", () => {
    const c = creditOverlaps([
      { id: "a", startMs: 0, endMs: m(30) },
      { id: "b", startMs: 0, endMs: m(30) },
      { id: "c", startMs: 0, endMs: m(30) },
    ]);
    expect(c.get("a")).toBe(10);
    expect(c.get("b")).toBe(10);
    expect(c.get("c")).toBe(10);
  });

  it("ne touche pas aux créneaux disjoints", () => {
    const c = creditOverlaps([
      { id: "a", startMs: 0, endMs: m(10) },
      { id: "b", startMs: m(20), endMs: m(30) },
    ]);
    expect(c.get("a")).toBe(10);
    expect(c.get("b")).toBe(10);
  });

  it("rawMinutes ne descend pas sous zéro", () => {
    expect(rawMinutes({ id: "x", startMs: m(5), endMs: m(2) })).toBe(0);
  });
});
