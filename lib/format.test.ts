import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatEuro,
  formatPersonName,
  personNameOrNull,
  sanitizeNameInput,
} from "./format";

describe("formatEuro", () => {
  it("formats whole numbers with euro symbol and french locale", () => {
    expect(formatEuro(1000)).toMatch(/1[\s ]000,00[\s ]€/);
  });

  it("handles zero", () => {
    expect(formatEuro(0)).toMatch(/0,00[\s ]€/);
  });

  it("handles decimals", () => {
    expect(formatEuro(1234.5)).toMatch(/1[\s ]234,50[\s ]€/);
  });
});

describe("formatDuration", () => {
  it("returns 0h for zero minutes", () => {
    expect(formatDuration(0)).toBe("0h");
  });

  it("returns Xmin under 1 hour", () => {
    expect(formatDuration(45)).toBe("45min");
  });

  it("returns whole hours without minutes", () => {
    expect(formatDuration(120)).toBe("2h");
  });

  it("returns hours and minutes padded", () => {
    expect(formatDuration(90)).toBe("1h30");
    expect(formatDuration(125)).toBe("2h05");
  });

  it("clamps negative values to 0h", () => {
    expect(formatDuration(-30)).toBe("0h");
  });
});

describe("formatDate", () => {
  it("formats Date in french DD/MM/YYYY", () => {
    expect(formatDate(new Date("2026-05-03T12:00:00Z"))).toBe("03/05/2026");
  });

  it("accepts ISO string", () => {
    expect(formatDate("2026-01-15")).toBe("15/01/2026");
  });
});

describe("formatDateTime", () => {
  it("formats Date with HH:MM", () => {
    const out = formatDateTime(new Date("2026-05-03T14:30:00"));
    expect(out).toMatch(/03\/05\/2026/);
    expect(out).toMatch(/14:30/);
  });
});

describe("formatPersonName", () => {
  it("assemble prénom et nom", () => {
    expect(formatPersonName("Frédéric", "Dupont")).toBe("Frédéric Dupont");
  });

  it("n'affiche pas « null » quand le nom manque", () => {
    // Le bug d'origine : `${first} ${last}` donnait "Frédéric null",
    // et .trim() ne l'enlevait pas.
    expect(formatPersonName("Frédéric", null)).toBe("Frédéric");
    expect(formatPersonName("Frédéric", undefined)).toBe("Frédéric");
    expect(formatPersonName("Frédéric", "")).toBe("Frédéric");
    expect(formatPersonName("Frédéric", "   ")).toBe("Frédéric");
    // Cas réellement présent en base : la chaîne "null".
    expect(formatPersonName("Elise", "null")).toBe("Elise");
    expect(formatPersonName("Elise", "NULL")).toBe("Elise");
    expect(formatPersonName("Elise", "undefined")).toBe("Elise");
  });

  it("gère un prénom manquant", () => {
    expect(formatPersonName(null, "Dupont")).toBe("Dupont");
    expect(formatPersonName("null", "Dupont")).toBe("Dupont");
  });

  it("retombe sur le libellé de repli quand tout manque", () => {
    expect(formatPersonName(null, null)).toBe("Sans nom");
    expect(formatPersonName("", "")).toBe("Sans nom");
    expect(formatPersonName(null, null, "—")).toBe("—");
  });

  it("nettoie les espaces superflus", () => {
    expect(formatPersonName("  Frédéric  ", "  Dupont ")).toBe("Frédéric Dupont");
  });
});

describe("personNameOrNull", () => {
  it("renvoie null plutôt qu'un repli", () => {
    expect(personNameOrNull(null, null)).toBeNull();
    expect(personNameOrNull("null", "")).toBeNull();
    expect(personNameOrNull("Frédéric", null)).toBe("Frédéric");
  });
});

describe("sanitizeNameInput", () => {
  it("neutralise la chaîne « null » produite par l'extraction IA", () => {
    // Cas réel : email signé « Frédéric » (m.frederic@gpasplus.com).
    // Le schéma exigeait une chaîne pour lastName, le modèle a écrit
    // littéralement "null", qui finissait affiché et recopié en base.
    expect(sanitizeNameInput("null")).toBe("");
    expect(sanitizeNameInput("NULL")).toBe("");
    expect(sanitizeNameInput("undefined")).toBe("");
  });

  it("renvoie une chaîne vide, jamais null (colonnes NOT NULL)", () => {
    expect(sanitizeNameInput(null)).toBe("");
    expect(sanitizeNameInput(undefined)).toBe("");
    expect(sanitizeNameInput(42)).toBe("");
    expect(sanitizeNameInput({})).toBe("");
  });

  it("préserve un vrai nom en le trimmant", () => {
    expect(sanitizeNameInput("  Frédéric ")).toBe("Frédéric");
    expect(sanitizeNameInput("Nn")).toBe("Nn");
  });

  it("chaînée avec formatPersonName, ne laisse rien passer", () => {
    const first = sanitizeNameInput("Frédéric");
    const last = sanitizeNameInput("null");
    expect(formatPersonName(first, last)).toBe("Frédéric");
  });

  it("donne la même clé de dédup aux deux formes du même contact", () => {
    // Le modèle avait produit deux propositions pour Frédéric : une
    // avec lastName "null", une avec "". Clés différentes → doublon.
    const a = formatPersonName(sanitizeNameInput("Frédéric"), sanitizeNameInput("null"), "");
    const b = formatPersonName(sanitizeNameInput("Frédéric"), sanitizeNameInput(""), "");
    expect(a).toBe(b);
  });
});
