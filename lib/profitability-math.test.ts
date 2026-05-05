import { describe, expect, it } from "vitest";
import {
  computeEffectiveHourlyRate,
  computeMargin,
  computeMarginPct,
  computeRevenue,
} from "./profitability-math";

describe("computeRevenue", () => {
  it("none → toujours 0", () => {
    expect(computeRevenue("none", 1000, 100, 600)).toBe(0);
  });

  it("fixed → budget plafonné, indépendant des heures", () => {
    expect(computeRevenue("fixed", 2000, 0, 0)).toBe(2000);
    expect(computeRevenue("fixed", 2000, 0, 600)).toBe(2000);
    expect(computeRevenue("fixed", 2000, 0, 6000)).toBe(2000);
  });

  it("hourly → minutes / 60 × taux", () => {
    expect(computeRevenue("hourly", 0, 100, 60)).toBe(100);
    expect(computeRevenue("hourly", 0, 100, 30)).toBe(50);
    expect(computeRevenue("hourly", 0, 80, 90)).toBe(120);
  });

  it("hourly à 0 minute → 0", () => {
    expect(computeRevenue("hourly", 0, 100, 0)).toBe(0);
  });
});

describe("computeMargin", () => {
  it("revenue - cost", () => {
    expect(computeMargin(2000, 800)).toBe(1200);
  });

  it("retourne valeur négative si projet en perte", () => {
    expect(computeMargin(500, 1000)).toBe(-500);
  });
});

describe("computeMarginPct", () => {
  it("calcule la marge en pourcentage du revenu", () => {
    expect(computeMarginPct(1000, 600)).toBe(40);
    expect(computeMarginPct(2000, 500)).toBe(75);
  });

  it("retourne null si revenu nul (évite division par zéro)", () => {
    expect(computeMarginPct(0, 0)).toBeNull();
    expect(computeMarginPct(0, 200)).toBeNull();
  });

  it("peut être négatif si projet en perte", () => {
    expect(computeMarginPct(1000, 1500)).toBe(-50);
  });
});

describe("computeEffectiveHourlyRate", () => {
  it("revenue / heures", () => {
    expect(computeEffectiveHourlyRate(2000, 600)).toBe(200); // 2000€ / 10h
    expect(computeEffectiveHourlyRate(1500, 720)).toBe(125); // 1500€ / 12h
  });

  it("null si pas d'heures", () => {
    expect(computeEffectiveHourlyRate(2000, 0)).toBeNull();
  });

  it("null si revenu nul", () => {
    expect(computeEffectiveHourlyRate(0, 600)).toBeNull();
  });
});
