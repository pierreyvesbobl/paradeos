import { describe, expect, it } from "vitest";
import { normalizeSupplierKey } from "./supplier-key";

describe("normalizeSupplierKey", () => {
  it("ignore casse, espaces et ponctuation", () => {
    expect(normalizeSupplierKey("Eleven Labs")).toBe("elevenlabs");
    expect(normalizeSupplierKey("ELEVENLABS")).toBe("elevenlabs");
    expect(normalizeSupplierKey("Eleven-Labs")).toBe("elevenlabs");
  });

  it("retire les formes juridiques internationales", () => {
    // Le cas qui a créé deux dossiers Drive côte à côte.
    expect(normalizeSupplierKey("ElevenLabs Inc.")).toBe("elevenlabs");
    expect(normalizeSupplierKey("OpenRouter, Inc.")).toBe("openrouter");
    expect(normalizeSupplierKey("Vercel Inc")).toBe("vercel");
    expect(normalizeSupplierKey("Acme LLC")).toBe("acme");
    expect(normalizeSupplierKey("Acme Ltd")).toBe("acme");
    expect(normalizeSupplierKey("Acme Limited")).toBe("acme");
    expect(normalizeSupplierKey("Acme GmbH")).toBe("acme");
  });

  it("retire les formes juridiques composées, itérativement", () => {
    expect(normalizeSupplierKey("Supabase Pte Ltd")).toBe("supabase");
    expect(normalizeSupplierKey("Supabase PteLtd")).toBe("supabase");
  });

  it("garde le comportement FR existant", () => {
    expect(normalizeSupplierKey("Orange SA")).toBe("orange");
    expect(normalizeSupplierKey("Google Cloud France SARL")).toBe("googlecloudfrance");
    expect(normalizeSupplierKey("SAS Parade")).toBe("parade");
  });

  it("ne rogne pas un nom qui contient une forme juridique par hasard", () => {
    expect(normalizeSupplierKey("Cisco")).toBe("cisco");
    expect(normalizeSupplierKey("Atlas")).toBe("atlas");
    // "Inc" ne doit pas manger la fin d'un mot court.
    expect(normalizeSupplierKey("Sinc")).toBe("sinc");
  });

  it("rapproche les variantes qui ont créé les doublons observés", () => {
    expect(normalizeSupplierKey("ElevenLabsInc")).toBe(normalizeSupplierKey("ElevenLabs"));
    expect(normalizeSupplierKey("SupabasePteLtd")).toBe(normalizeSupplierKey("Supabase"));
    expect(normalizeSupplierKey("OpenRouterInc")).toBe(normalizeSupplierKey("OpenRouter"));
  });
});
