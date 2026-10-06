import { describe, expect, it } from "vitest";
import { toFrenchTitleCase } from "./case";

describe("toFrenchTitleCase", () => {
  it("met les particules en minuscules sauf en tête", () => {
    expect(toFrenchTitleCase("RUE DES CERISIERS")).toBe("Rue des Cerisiers");
    expect(toFrenchTitleCase("4 BOULEVARD DE MONS")).toBe("4 Boulevard de Mons");
    expect(toFrenchTitleCase("LA ROCHE SUR YON")).toBe("La Roche sur Yon");
  });

  it("conserve tirets et apostrophes", () => {
    expect(toFrenchTitleCase("VILLENEUVE-D'ASCQ")).toBe("Villeneuve-d'Ascq");
    expect(toFrenchTitleCase("SAINT-CLEMENT-DE-RIVIERE")).toBe("Saint-Clement-de-Riviere");
    expect(toFrenchTitleCase("L'ILE-SAINT-DENIS")).toBe("L'Ile-Saint-Denis");
  });

  it("ne laisse pas un numéro consommer la position de tête", () => {
    expect(toFrenchTitleCase("17 RUE DU 8 MAI 1945")).toBe("17 Rue du 8 Mai 1945");
  });

  it("préserve les sigles d'adresse", () => {
    expect(toFrenchTitleCase("BP 12 ZI DES GRANDS CHAMPS")).toBe("BP 12 ZI des Grands Champs");
    expect(toFrenchTitleCase("75002 PARIS CEDEX 02")).toBe("75002 Paris CEDEX 02");
  });

  it("traite la ponctuation comme un séparateur", () => {
    expect(toFrenchTitleCase("BOBL (BOBL)")).toBe("Bobl (Bobl)");
    expect(toFrenchTitleCase("SARL DUPONT & FILS")).toBe("Sarl Dupont & Fils");
  });

  it("n'invente pas les accents absents de la source INSEE", () => {
    expect(toFrenchTitleCase("BOULEVARD DE SEBASTOPOL")).toBe("Boulevard de Sebastopol");
  });
});
