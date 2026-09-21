import { describe, expect, it } from "vitest";
import { parsePurchaseFilename } from "./filename";

/** Raccourci de lecture : "2026-09-21" au lieu d'un Date à comparer. */
function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

describe("parsePurchaseFilename — convention Parade OS", () => {
  it.each([
    ["260921_facture_AbonnementLogiciel_ElevenLabs.pdf", "2026-09-21", "ElevenLabs"],
    ["260301_facture_Hebergement_OVH.pdf", "2026-03-01", "OVH"],
    ["251231_facture_LoyerBureau_SCIFLV.pdf", "2025-12-31", "SCIFLV"],
  ])("lit « %s »", (name, date, supplier) => {
    const parsed = parsePurchaseFilename(name);
    expect(iso(parsed.invoiceDate)).toBe(date);
    expect(parsed.supplierLabel).toBe(supplier);
  });
});

describe("parsePurchaseFilename — ancienne chaîne", () => {
  it.each([
    ["260401_facture_hostinger", "2026-04-01", "hostinger"],
    ["260320_facture_maxicoffee", "2026-03-20", "maxicoffee"],
    // Date à 8 chiffres malformée : lue en JJMMAAAA.
    ["26022026_facture_supabase", "2026-02-26", "supabase"],
  ])("lit « %s »", (name, date, supplier) => {
    const parsed = parsePurchaseFilename(name);
    expect(iso(parsed.invoiceDate)).toBe(date);
    expect(parsed.supplierLabel).toBe(supplier);
  });

  it("lit une date à 8 chiffres en AAAAMMJJ quand JJMMAAAA est impossible", () => {
    // 20260415 : "20" n'est pas un mois valide en JJMMAAAA (04/26/… non plus).
    expect(iso(parsePurchaseFilename("20260415_facture_ovh").invoiceDate)).toBe("2026-04-15");
  });
});

describe("parsePurchaseFilename — ce qu'on refuse de deviner", () => {
  it("rend une date nulle sur un 31 février", () => {
    expect(parsePurchaseFilename("260231_facture_ovh").invoiceDate).toBeNull();
  });

  it("rend une date nulle sur un mois 13", () => {
    expect(parsePurchaseFilename("261301_facture_ovh").invoiceDate).toBeNull();
  });

  it("rend une date nulle quand le nom ne commence pas par des chiffres", () => {
    expect(parsePurchaseFilename("Invoice-4821.pdf").invoiceDate).toBeNull();
  });

  it.each([["260401_facture"], ["260401_facture_2026"], ["260401"]])(
    "ne sort pas de fournisseur de « %s »",
    (name) => {
      expect(parsePurchaseFilename(name).supplierLabel).toBeNull();
    },
  );

  it("rend tout nul sur un nom vide", () => {
    expect(parsePurchaseFilename("   ")).toEqual({ invoiceDate: null, supplierLabel: null });
  });
});

describe("parsePurchaseFilename — extensions", () => {
  it("retire une extension courte", () => {
    expect(parsePurchaseFilename("260401_facture_ovh.pdf").supplierLabel).toBe("ovh");
  });

  it("garde un suffixe qui n'est pas une extension", () => {
    expect(parsePurchaseFilename("260401_facture_ovh.Mars2026").supplierLabel).toBe("ovh.Mars2026");
  });
});
