import { describe, expect, it } from "vitest";
import { classifyCompanyProbe, companyAccessError } from "./company-access";

describe("classifyCompanyProbe", () => {
  it("lit 2xx comme un accès, 404/403 comme un autre compte, 401 comme un cookie mort", () => {
    expect(classifyCompanyProbe(200)).toBe("ok");
    expect(classifyCompanyProbe(404)).toBe("no_access");
    expect(classifyCompanyProbe(403)).toBe("no_access");
    expect(classifyCompanyProbe(401)).toBe("invalid");
  });

  it("ne tranche pas sur une panne Dougs ou une redirection", () => {
    expect(classifyCompanyProbe(500)).toBe("unknown");
    expect(classifyCompanyProbe(503)).toBe("unknown");
    expect(classifyCompanyProbe(302)).toBe("unknown");
  });
});

describe("companyAccessError", () => {
  it("refuse un compte sans accès et un cookie mort, laisse passer le reste", () => {
    expect(companyAccessError("no_access", "107610")).toMatch(/107610/);
    expect(companyAccessError("invalid", "107610")).not.toBeNull();
    expect(companyAccessError("ok", "107610")).toBeNull();
    expect(companyAccessError("unknown", "107610")).toBeNull();
  });
});
