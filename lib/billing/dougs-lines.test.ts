import { describe, expect, it } from "vitest";
import { dougsLine } from "./dougs-lines";

describe("dougsLine", () => {
  const base = {
    title: "Prestation d'hébergement",
    description: "2 postes × 299,5 €/mois × 3 mois",
    unit: "mois",
    quantity: 3,
    unitAmount: 599,
    vatRate: 0.2,
  };

  it("calcule le total depuis quantité × unitaire", () => {
    expect(dougsLine(base).amount).toBe(1797);
  });

  it("arrondit au centime pour ne pas envoyer un flottant sale", () => {
    // 3 × 599.7 = 1799.1000000000001 en IEEE 754.
    expect(dougsLine({ ...base, unitAmount: 599.7 }).amount).toBe(1799.1);
  });

  it("fixe les champs que Dougs attend toujours à l'identique", () => {
    const line = dougsLine(base);
    expect(line.discount).toBe(0);
    expect(line.discountUnit).toBe("%");
    expect(line.discountInEuros).toBe(0);
    expect(line.reference).toBeNull();
    // Les prix sont saisis HT : laisser Dougs croire l'inverse doublerait
    // la TVA sur le document.
    expect(line.isPriceWithVat).toBe(false);
  });

  it("tient un montant nul sans produire -0", () => {
    expect(dougsLine({ ...base, unitAmount: 0 }).amount).toBe(0);
  });
});
