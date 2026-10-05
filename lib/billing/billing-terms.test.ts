import { describe, expect, it } from "vitest";
import {
  DUE_DATE_OPTIONS,
  dueDateFrom,
  dueDaysForOption,
  isDueDateOption,
  parseBillingTerms,
  resolveBillingTerms,
} from "./billing-terms";

describe("options d'échéance", () => {
  it("n'expose que les valeurs que Dougs accepte", () => {
    // Vérifié par sondage le 2026-10-05 : ON_RECEIPT, DAYS_7, DAYS_45 et
    // END_OF_MONTH font répondre 400. Les ajouter ici casserait les push.
    expect(Object.keys(DUE_DATE_OPTIONS)).toEqual(["DAYS_15", "DAYS_30", "DAYS_60"]);
  });

  it("rejette les options refusées par Dougs", () => {
    expect(isDueDateOption("DAYS_45")).toBe(false);
    expect(isDueDateOption("ON_RECEIPT")).toBe(false);
    expect(isDueDateOption("DAYS_15")).toBe(true);
  });

  it("retombe sur 30 jours plutôt que sur NaN", () => {
    expect(dueDaysForOption(undefined)).toBe(30);
    expect(dueDaysForOption("n'importe quoi")).toBe(30);
    expect(dueDaysForOption("DAYS_60")).toBe(60);
  });
});

describe("parseBillingTerms", () => {
  it("ignore ce qui n'est pas exploitable", () => {
    expect(parseBillingTerms(null)).toEqual({});
    expect(parseBillingTerms("texte")).toEqual({});
    expect(parseBillingTerms([])).toEqual({});
    expect(parseBillingTerms({ paymentTerms: 42 })).toEqual({});
  });

  it("écarte une échéance que Dougs refuserait", () => {
    expect(parseBillingTerms({ dueDateOption: "DAYS_45" })).toEqual({});
  });

  it("ignore une chaîne de modalités vide", () => {
    expect(parseBillingTerms({ paymentTerms: "   " })).toEqual({});
  });

  it("garde thankYouNote à null, qui veut dire « effacer »", () => {
    expect(parseBillingTerms({ thankYouNote: null })).toEqual({ thankYouNote: null });
  });

  it("filtre les éléments non textuels des mentions de pied", () => {
    expect(parseBillingTerms({ footerOthers: ["CGV", 3, null] })).toEqual({
      footerOthers: ["CGV"],
    });
  });
});

describe("resolveBillingTerms", () => {
  it("sans surcharge, rend les défauts de la marque", () => {
    const r = resolveBillingTerms("coworking", null);
    expect(r.dueDays).toBe(15);
    expect(r.document.paymentTerms).toContain("15 jours");
    expect(r.document.invoicerOthers).toEqual(["La Cachette est une marque de Parade SAS"]);
  });

  it("la surcharge du deal gagne, clé par clé", () => {
    const r = resolveBillingTerms("coworking", {
      paymentTerms: "30 % à la commande, solde à 60 jours.",
      dueDateOption: "DAYS_60",
    });
    expect(r.document.paymentTerms).toBe("30 % à la commande, solde à 60 jours.");
    expect(r.dueDays).toBe(60);
    // Non surchargé : le défaut de marque survit.
    expect(r.document.invoicerOthers).toEqual(["La Cachette est une marque de Parade SAS"]);
  });

  it("l'échéance suivie découle de celle du document, toujours", () => {
    // C'est l'invariant qui empêche le PDF et les relances de divergent.
    for (const option of ["DAYS_15", "DAYS_30", "DAYS_60"] as const) {
      const r = resolveBillingTerms("automato", { dueDateOption: option });
      expect(r.dueDays).toBe(DUE_DATE_OPTIONS[option]);
      expect(r.document.dueDateOption).toBe(option);
    }
  });

  it("ne laisse pas une surcharge invalide déplacer l'échéance", () => {
    const r = resolveBillingTerms("coworking", { dueDateOption: "DAYS_45" });
    expect(r.document.dueDateOption).toBe("DAYS_15");
    expect(r.dueDays).toBe(15);
  });

  it("ne modifie pas le template de la marque", () => {
    resolveBillingTerms("coworking", { paymentTerms: "autre" });
    expect(resolveBillingTerms("coworking", null).document.paymentTerms).toContain("15 jours");
  });
});

describe("dueDateFrom", () => {
  it("décale sans toucher à la date d'origine", () => {
    const base = new Date(2026, 9, 5);
    expect(dueDateFrom(base, 15).getDate()).toBe(20);
    expect(base.getDate()).toBe(5);
  });

  it("traverse un changement de mois", () => {
    expect(dueDateFrom(new Date(2026, 9, 25), 30).getMonth()).toBe(10);
  });
});
