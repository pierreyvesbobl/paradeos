import { describe, expect, it } from "vitest";
import { buildDraftUpdatePayload } from "./dougs-document";

describe("buildDraftUpdatePayload", () => {
  const draft = {
    id: "d1",
    number: 55,
    numberPrefix: "2026-10-FAC",
    subject: "Ancien objet",
    lines: [{ title: "x", amount: 10 }],
    legalData: { iban: "FR76…", paymentTerms: "30 jours" },
    clientData: { name: "ACME", city: "Lyon" },
  };

  it("garde tout le brouillon et ne touche qu'à ce qu'on change", () => {
    const out = buildDraftUpdatePayload(draft, { subject: "Nouvel objet" });
    expect(out.subject).toBe("Nouvel objet");
    expect(out.number).toBe(55);
    expect(out.lines).toEqual(draft.lines);
    expect(out.legalData).toEqual(draft.legalData);
    expect(out.clientData).toEqual(draft.clientData);
  });

  it("fusionne le client plutôt que de le remplacer", () => {
    const out = buildDraftUpdatePayload(draft, { client: { email: "a@b.fr" } });
    expect(out.clientData).toEqual({ name: "ACME", city: "Lyon", email: "a@b.fr" });
  });

  it("fusionne les modalités de paiement sans perdre l'IBAN", () => {
    const out = buildDraftUpdatePayload(draft, { document: { paymentTerms: "à réception" } });
    expect(out.legalData).toEqual({ iban: "FR76…", paymentTerms: "à réception" });
  });
});
