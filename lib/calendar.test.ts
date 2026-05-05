import { describe, expect, it } from "vitest";
import {
  addDays,
  formatWeekRange,
  isoDate,
  localDateTimeInput,
  minutesBetween,
  startOfIsoWeek,
} from "./calendar";

describe("startOfIsoWeek", () => {
  it("returns Monday for any day in the same ISO week", () => {
    // 2026-05-03 = dimanche → semaine commence lundi 27 avril 2026
    const sunday = new Date(2026, 4, 3);
    const monday = startOfIsoWeek(sunday);
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getDate()).toBe(27);
    expect(monday.getMonth()).toBe(3); // April
  });

  it("returns same day if input is already Monday", () => {
    const monday = new Date(2026, 4, 4); // Monday May 4
    const start = startOfIsoWeek(monday);
    expect(start.getDate()).toBe(4);
  });

  it("normalizes time to 00:00:00", () => {
    const noon = new Date(2026, 4, 7, 14, 30, 25);
    const start = startOfIsoWeek(noon);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    const d = new Date(2026, 0, 1);
    expect(addDays(d, 31).getDate()).toBe(1);
    expect(addDays(d, 31).getMonth()).toBe(1); // February
  });

  it("subtracts with negative", () => {
    const d = new Date(2026, 4, 5);
    const earlier = addDays(d, -10);
    expect(earlier.getMonth()).toBe(3); // April
    expect(earlier.getDate()).toBe(25);
  });

  it("does not mutate input", () => {
    const original = new Date(2026, 0, 1);
    addDays(original, 5);
    expect(original.getDate()).toBe(1);
  });
});

describe("isoDate", () => {
  it("returns YYYY-MM-DD with zero padding", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(isoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("localDateTimeInput", () => {
  it("returns YYYY-MM-DDTHH:mm", () => {
    expect(localDateTimeInput(new Date(2026, 4, 3, 14, 30))).toBe("2026-05-03T14:30");
  });
});

describe("formatWeekRange", () => {
  it("renders a same-year range without redundant year", () => {
    const start = new Date(2026, 4, 4); // Lundi 4 mai 2026
    const out = formatWeekRange(start);
    expect(out).toMatch(/4 mai/);
    expect(out).toMatch(/10 mai 2026/);
  });
});

describe("minutesBetween", () => {
  it("computes positive difference in minutes", () => {
    const a = new Date(2026, 4, 3, 9, 0);
    const b = new Date(2026, 4, 3, 11, 30);
    expect(minutesBetween(a, b)).toBe(150);
  });

  it("returns 0 for identical dates", () => {
    const a = new Date(2026, 4, 3, 9, 0);
    expect(minutesBetween(a, a)).toBe(0);
  });
});
