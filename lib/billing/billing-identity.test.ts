import { describe, expect, it, vi } from "vitest";
import type { SireneCompany } from "@/lib/gouv/sirene";
import {
  billingIdentityWarnings,
  completeBillingIdentity,
  frenchVatNumberFromSiren,
  normalizeSiren,
} from "./billing-identity";

describe("frenchVatNumberFromSiren", () => {
  // Clés vérifiées sur des numéros réels (annuaire des entreprises).
  it.each([
    ["911556421", "FR73911556421"],
    ["823030085", "FR81823030085"],
    ["101453967", "FR66101453967"],
    ["932746878", "FR69932746878"],
  ])("calcule la clé de %s", (siren, expected) => {
    expect(frenchVatNumberFromSiren(siren)).toBe(expected);
  });

  it("accepte les espaces de saisie et refuse ce qui n'est pas un SIREN", () => {
    expect(frenchVatNumberFromSiren("911 556 421")).toBe("FR73911556421");
    expect(frenchVatNumberFromSiren("91155642100020")).toBeNull();
    expect(frenchVatNumberFromSiren("")).toBeNull();
    expect(frenchVatNumberFromSiren(null)).toBeNull();
    expect(normalizeSiren("911-556-421")).toBe("911556421");
  });
});

function company(over: Partial<SireneCompany> = {}): SireneCompany {
  return {
    siren: "911556421",
    siret: "91155642100020",
    name: "Bobl",
    legalName: "BOBL",
    vatNumber: "FR73911556421",
    address: null,
    addressLabel: null,
    active: true,
    undisclosed: false,
    establishments: [],
    ...over,
  };
}

describe("completeBillingIdentity", () => {
  it("ne fait rien sans SIREN", async () => {
    const lookup = vi.fn();
    const out = await completeBillingIdentity(
      { siren: null, siret: null, vatNumber: null },
      { lookup },
    );
    expect(out).toEqual({ siren: null, siret: null, vatNumber: null, derived: [] });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("calcule la TVA sans réseau et va chercher le SIRET du siège", async () => {
    const lookup = vi.fn(async () => [company()]);
    const out = await completeBillingIdentity(
      { siren: "911556421", siret: null, vatNumber: null, country: "France" },
      { lookup },
    );
    expect(out).toEqual({
      siren: "911556421",
      siret: "91155642100020",
      vatNumber: "FR73911556421",
      derived: ["vatNumber", "siret"],
    });
    expect(lookup).toHaveBeenCalledWith("911556421", 3);
  });

  it("ne remplace jamais une valeur renseignée et n'interroge pas l'annuaire inutilement", async () => {
    const lookup = vi.fn();
    const out = await completeBillingIdentity(
      { siren: "911556421", siret: "91155642100038", vatNumber: "FR73911556421" },
      { lookup },
    );
    expect(out.siret).toBe("91155642100038");
    expect(out.derived).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("écarte un SIRET qui n'appartient pas au SIREN", async () => {
    const lookup = vi.fn(async () => [company()]);
    const out = await completeBillingIdentity(
      { siren: "911556421", siret: "82303008500011", vatNumber: null },
      { lookup },
    );
    expect(out.siret).toBe("91155642100020");
  });

  it("ne calcule pas de TVA française pour une adresse étrangère", async () => {
    const lookup = vi.fn(async () => []);
    const out = await completeBillingIdentity(
      { siren: "911556421", siret: null, vatNumber: null, country: "Belgique" },
      { lookup },
    );
    expect(out.vatNumber).toBeNull();
  });

  it("survit à une panne de l'annuaire", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("429");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await completeBillingIdentity(
      { siren: "911556421", siret: null, vatNumber: null },
      { lookup },
    );
    expect(out).toEqual({
      siren: "911556421",
      siret: null,
      vatNumber: "FR73911556421",
      derived: ["vatNumber"],
    });
    warn.mockRestore();
  });

  it("ignore un homonyme renvoyé par l'annuaire", async () => {
    const lookup = vi.fn(async () => [company({ siren: "000000000", siret: "00000000000011" })]);
    const out = await completeBillingIdentity(
      { siren: "911556421", siret: null, vatNumber: "FR73911556421" },
      { lookup },
    );
    expect(out.siret).toBeNull();
  });
});

describe("billingIdentityWarnings", () => {
  it("se tait pour un particulier et pour une identité complète", () => {
    expect(billingIdentityWarnings({ isBToB: false }, "Jean")).toEqual([]);
    expect(
      billingIdentityWarnings(
        { isBToB: true, siren: "911556421", siret: "91155642100020", vatNumber: "FR73911556421" },
        "Bobl",
      ),
    ).toEqual([]);
  });

  it("signale d'abord l'absence de SIREN, sinon chaque champ manquant", () => {
    expect(billingIdentityWarnings({ isBToB: true, siren: null }, "ACME")).toHaveLength(1);
    expect(billingIdentityWarnings({ isBToB: true, siren: null }, "ACME")[0]).toMatch(/SIREN/);
    const two = billingIdentityWarnings(
      { isBToB: true, siren: "911556421", siret: "", vatNumber: null },
      "ACME",
    );
    expect(two).toHaveLength(2);
    expect(two[0]).toMatch(/SIRET/);
    expect(two[1]).toMatch(/TVA/);
  });
});
