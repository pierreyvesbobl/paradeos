import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACOMPTE_PERCENT,
  buildMilestoneDougsLine,
  coworkingInvoiceAmountHt,
  coworkingPeriodFromDate,
  milestoneFromDetectedPercent,
  splitMilestoneAmounts,
  toLocalISODate,
} from "./milestones-math";

describe("splitMilestoneAmounts", () => {
  it("40/60 par défaut, avec les libellés", () => {
    expect(DEFAULT_ACOMPTE_PERCENT).toBe(40);
    expect(splitMilestoneAmounts(10000)).toEqual({
      acompte: { percent: 40, amountHt: 4000, label: "Acompte 40 %" },
      solde: { percent: 60, amountHt: 6000, label: "Solde 60 %" },
    });
  });

  it("arrondit l'acompte au centime et met le reste sur le solde", () => {
    // 1234.56 × 40 % = 493.824 → 493.82 ; solde = 740.74
    const s = splitMilestoneAmounts(1234.56);
    expect(s.acompte.amountHt).toBe(493.82);
    expect(s.solde.amountHt).toBe(740.74);
  });

  it("la somme des jalons retombe toujours sur le total", () => {
    for (const [total, pct] of [
      [1000.01, 40],
      [333.33, 30],
      [99.99, 50],
      [12345.67, 33],
      [0.01, 40],
    ] as const) {
      const s = splitMilestoneAmounts(total, pct);
      expect(Math.round((s.acompte.amountHt + s.solde.amountHt) * 100) / 100).toBe(total);
    }
  });

  it("333.33 à 30 % : 99.999 devient 100.00", () => {
    const s = splitMilestoneAmounts(333.33, 30);
    expect(s.acompte.amountHt).toBe(100);
    expect(s.solde.amountHt).toBe(233.33);
    expect(s.solde.label).toBe("Solde 70 %");
  });

  it("accepte les bornes 0 % et 100 %", () => {
    expect(splitMilestoneAmounts(500, 100)).toMatchObject({
      acompte: { percent: 100, amountHt: 500 },
      solde: { percent: 0, amountHt: 0, label: "Solde 0 %" },
    });
    expect(splitMilestoneAmounts(500, 0)).toMatchObject({
      acompte: { percent: 0, amountHt: 0, label: "Acompte 0 %" },
      solde: { percent: 100, amountHt: 500 },
    });
  });

  it("un total à 0 donne deux jalons à 0", () => {
    const s = splitMilestoneAmounts(0);
    expect(s.acompte.amountHt).toBe(0);
    expect(s.solde.amountHt).toBe(0);
  });

  it("un pourcentage non entier est reporté tel quel dans le libellé", () => {
    // Le schéma de l'action n'impose pas d'entier ; le libellé le reflète.
    expect(splitMilestoneAmounts(1000, 33.5).acompte.label).toBe("Acompte 33.5 %");
    expect(splitMilestoneAmounts(1000, 33.5).solde.percent).toBe(66.5);
  });
});

describe("milestoneFromDetectedPercent", () => {
  it("< 50 → acompte", () => {
    expect(milestoneFromDetectedPercent(40, "F-1")).toEqual({
      milestoneType: "acompte",
      label: "Acompte 40 %",
    });
    expect(milestoneFromDetectedPercent(30, null).label).toBe("Acompte 30 %");
  });

  it("> 50 → solde", () => {
    expect(milestoneFromDetectedPercent(60, null)).toEqual({
      milestoneType: "solde",
      label: "Solde 60 %",
    });
    expect(milestoneFromDetectedPercent(70, null).label).toBe("Solde 70 %");
  });

  it("≥ 95 → facture unique « Solde 100 % » même si le % détecté est 95", () => {
    expect(milestoneFromDetectedPercent(100, null).label).toBe("Solde 100 %");
    expect(milestoneFromDetectedPercent(95, null)).toEqual({
      milestoneType: "solde",
      label: "Solde 100 %",
    });
  });

  it("50 pile ou inconnu → intermédiaire, libellé sur la référence Dougs", () => {
    expect(milestoneFromDetectedPercent(50, "F-2026-0042")).toEqual({
      milestoneType: "intermediaire",
      label: "Facture F-2026-0042",
    });
    expect(milestoneFromDetectedPercent(null, "F-2026-0042").label).toBe("Facture F-2026-0042");
    expect(milestoneFromDetectedPercent(null, null).label).toBe("Facture");
  });
});

describe("coworkingInvoiceAmountHt", () => {
  it("postes × prix mensuel × mois", () => {
    expect(coworkingInvoiceAmountHt(2, 350, 3)).toBe(2100);
    expect(coworkingInvoiceAmountHt(1, 750, 1)).toBe(750);
  });

  it("arrondit au centime", () => {
    expect(coworkingInvoiceAmountHt(1, 333.333, 1)).toBe(333.33);
    expect(coworkingInvoiceAmountHt(3, 0.1, 3)).toBe(0.9);
    expect(coworkingInvoiceAmountHt(1, 10.005, 1)).toBe(10.01);
  });
});

describe("coworkingPeriodFromDate", () => {
  it("mensuel : du 1er au dernier jour du mois de la facture", () => {
    expect(coworkingPeriodFromDate(new Date(2026, 2, 15), "monthly")).toEqual({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      months: 1,
    });
  });

  it("trimestriel : 3 mois glissants à partir du mois de la facture", () => {
    expect(coworkingPeriodFromDate(new Date(2026, 2, 15), "quarterly")).toEqual({
      periodStart: "2026-03-01",
      periodEnd: "2026-05-31",
      months: 3,
    });
  });

  it("gère février (année bissextile ou non)", () => {
    expect(coworkingPeriodFromDate(new Date(2027, 1, 10), "monthly").periodEnd).toBe("2027-02-28");
    expect(coworkingPeriodFromDate(new Date(2028, 1, 10), "monthly").periodEnd).toBe("2028-02-29");
  });

  it("passe l'année sur un trimestre à cheval sur décembre", () => {
    expect(coworkingPeriodFromDate(new Date(2026, 11, 3), "quarterly")).toEqual({
      periodStart: "2026-12-01",
      periodEnd: "2027-02-28",
      months: 3,
    });
  });

  it("fréquence inconnue ou nulle → mensuel", () => {
    expect(coworkingPeriodFromDate(new Date(2026, 0, 31), null).months).toBe(1);
    expect(coworkingPeriodFromDate(new Date(2026, 0, 31), "yearly").periodEnd).toBe("2026-01-31");
  });
});

describe("toLocalISODate", () => {
  it("pad mois et jour", () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("buildMilestoneDougsLine", () => {
  const base = { label: "Acompte 40 %", amountHt: 4000, vatRate: 0.2, projectName: "Refonte" };

  it("décrit le jalon par son pourcentage, formaté fr-FR", () => {
    const line = buildMilestoneDougsLine({ ...base, milestonePercent: 40 });
    expect(line.description).toBe('40 % du projet "Refonte".');
    expect(buildMilestoneDougsLine({ ...base, milestonePercent: 33.5 }).description).toBe(
      '33,5 % du projet "Refonte".',
    );
  });

  it("décrit une facture sans pourcentage comme liée au projet", () => {
    expect(buildMilestoneDougsLine({ ...base, milestonePercent: null }).description).toBe(
      'Facture liée au projet "Refonte".',
    );
  });

  it("produit une ligne forfaitaire HT, sans remise", () => {
    const line = buildMilestoneDougsLine({ ...base, milestonePercent: 40 });
    expect(line).toMatchObject({
      title: "Acompte 40 %",
      unit: "forfait",
      quantity: 1,
      unitAmount: 4000,
      amount: 4000,
      vatRate: 0.2,
      discount: 0,
      discountUnit: "%",
      discountInEuros: 0,
      reference: null,
      isPriceWithVat: false,
    });
  });
});
