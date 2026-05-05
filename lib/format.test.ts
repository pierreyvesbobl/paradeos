import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDuration, formatEuro } from "./format";

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
