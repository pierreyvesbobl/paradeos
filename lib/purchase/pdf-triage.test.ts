import { describe, expect, it } from "vitest";
import { condenseInvoiceText, isPermanentExtractionFailure } from "./pdf-triage";

describe("condenseInvoiceText", () => {
  it("laisse un texte court intact", () => {
    const text = "Facture OVH\nTotal TTC 12,00 €";
    expect(condenseInvoiceText(text)).toBe(text);
  });

  it("garde la tête et le pied d'un texte long", () => {
    const head = `EN-TETE${"a".repeat(6_000)}`;
    const belly = "b".repeat(50_000);
    const tail = `${"c".repeat(2_400)}TOTAL TTC 131,50`;
    const condensed = condenseInvoiceText(head + belly + tail);

    expect(condensed.startsWith("EN-TETE")).toBe(true);
    expect(condensed.endsWith("TOTAL TTC 131,50")).toBe(true);
    expect(condensed).toContain("lignes de détail omises");
    expect(condensed.length).toBeLessThan(9_000);
  });

  it("ne perd pas le total d'une facture de conso à rallonge", () => {
    // Cas réel : facture d'API avec des milliers de lignes d'usage entre
    // l'en-tête et le total.
    const invoice = `OpenAI\nFacture INV-4821\n${"ligne d'usage\n".repeat(5_000)}Total TTC $42.17`;
    expect(condenseInvoiceText(invoice)).toContain("Total TTC $42.17");
    expect(condenseInvoiceText(invoice)).toContain("INV-4821");
  });
});

describe("isPermanentExtractionFailure", () => {
  it.each([
    ["Invalid PDF structure."],
    ["invalid pdf structure"],
    ["No PDF header found"],
    ["Unexpected end of file"],
  ])("déclare « %s » définitif", (message) => {
    expect(isPermanentExtractionFailure(message)).toBe(true);
  });

  it.each([
    ["The operation was aborted due to timeout"],
    ["fetch failed"],
    ["Dougs 429 Too Many Requests"],
    ["Drive download 500 : internal error"],
  ])("laisse « %s » réessayable", (message) => {
    expect(isPermanentExtractionFailure(message)).toBe(false);
  });
});
