import { describe, expect, it } from "vitest";
import {
  demoAmount,
  demoCompanyName,
  demoContactName,
  demoEmail,
  demoProjectName,
} from "./anonymize";

describe("demo anonymizers — déterminisme", () => {
  it("renvoie le même alias entreprise pour le même id", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(demoCompanyName(id)).toBe(demoCompanyName(id));
  });

  it("renvoie des alias différents pour des ids différents (collision rare)", () => {
    const names = new Set(Array.from({ length: 100 }, (_, i) => demoCompanyName(`id-${i}`)));
    expect(names.size).toBeGreaterThan(50);
  });

  it("renvoie le même contact pour le même id", () => {
    const id = "contact-uuid";
    const a = demoContactName(id);
    const b = demoContactName(id);
    expect(a).toEqual(b);
  });

  it("renvoie le même projet pour le même id", () => {
    const id = "proj-1";
    expect(demoProjectName(id)).toBe(demoProjectName(id));
  });

  it("renvoie un email plausible sans accents", () => {
    const email = demoEmail("user-1");
    expect(email).toMatch(/^[a-z]+\.[a-z]+@demo\.local$/);
  });
});

describe("demoAmount", () => {
  it("renvoie le même montant pour le même id", () => {
    expect(demoAmount("inv-1", 1000)).toBe(demoAmount("inv-1", 1000));
  });

  it("multiplie dans la plage [0.70, 1.40]", () => {
    for (let i = 0; i < 200; i++) {
      const out = demoAmount(`id-${i}`, 1000);
      expect(out).toBeGreaterThanOrEqual(700);
      expect(out).toBeLessThanOrEqual(1400);
    }
  });

  it("préserve 0", () => {
    expect(demoAmount("x", 0)).toBe(0);
  });

  it("préserve le signe", () => {
    const positive = demoAmount("avoir", 500);
    const negative = demoAmount("avoir", -500);
    expect(negative).toBe(-positive);
  });
});
