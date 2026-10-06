import { describe, expect, it } from "vitest";
import { CRON_MAX_DURATION_MS, canStartAnotherItem, START_CUTOFF_MS } from "./run-budget";

describe("canStartAnotherItem", () => {
  const t0 = 1_000_000;

  it("laisse toujours partir le premier élément, même après une longue mise en route", () => {
    expect(canStartAnotherItem(t0, 0, t0 + 250_000)).toBe(true);
  });

  it("autorise un élément de plus tant que son pire cas tient dans la fenêtre", () => {
    expect(canStartAnotherItem(t0, 1, t0 + 10_000)).toBe(true);
    expect(canStartAnotherItem(t0, 1, t0 + START_CUTOFF_MS)).toBe(true);
  });

  it("refuse dès que l'extraction la plus lente déborderait", () => {
    expect(canStartAnotherItem(t0, 1, t0 + START_CUTOFF_MS + 1)).toBe(false);
    expect(canStartAnotherItem(t0, 3, t0 + 200_000)).toBe(false);
  });

  it("garde une marge réelle sous la limite de la plateforme", () => {
    expect(START_CUTOFF_MS).toBeGreaterThan(0);
    expect(START_CUTOFF_MS).toBeLessThan(CRON_MAX_DURATION_MS / 2);
  });
});
