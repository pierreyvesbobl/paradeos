import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatEuro,
  formatPersonName,
  personNameOrNull,
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
