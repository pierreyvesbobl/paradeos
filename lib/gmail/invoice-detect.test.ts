import { describe, expect, it } from "vitest";
import { looksLikeInvoiceMessage, pickInvoicePdfs } from "./invoice-detect";

function message(overrides: Partial<Parameters<typeof looksLikeInvoiceMessage>[0]>) {
  return { subject: null, fromEmail: null, labelNames: [], ...overrides };
}

describe("looksLikeInvoiceMessage", () => {
  it.each([
    "Votre facture Alan Santé pour août 2026 !",
    "Payment received for Supabase Pte. Ltd. invoice (#KHJPXD-00013)",
    "Your receipt from OpenRouter, Inc #2064-7551",
    "Votre justificatif d'achat 0116926013888",
    "Quittance contrat d'assurance Stello",
  ])("détecte le sujet « %s »", (subject) => {
    expect(looksLikeInvoiceMessage(message({ subject }))).toBe(true);
  });

  it.each(["Re: bien reçu, merci", "Reçu 5 sur 5", "Point migration + quelques demandes"])(
    "ignore le sujet « %s »",
    (subject) => {
      expect(looksLikeInvoiceMessage(message({ subject }))).toBe(false);
    },
  );

  it.each(["invoice+statements@openrouter.ai", "facturation@promeom.fr", "billing@acme.io"])(
    "détecte l'expéditeur %s",
    (fromEmail) => {
      expect(looksLikeInvoiceMessage(message({ subject: "Document", fromEmail }))).toBe(true);
    },
  );

  it("ignore un expéditeur ordinaire", () => {
    const m = message({ subject: "Document", fromEmail: "g.staub@prevandcare.com" });
    expect(looksLikeInvoiceMessage(m)).toBe(false);
  });

  it("détecte un libellé Gmail de factures, même imbriqué", () => {
    expect(looksLikeInvoiceMessage(message({ labelNames: ["IMPORTANT", "factures"] }))).toBe(true);
    expect(looksLikeInvoiceMessage(message({ labelNames: ["Compta/Invoices"] }))).toBe(true);
  });

  it("ignore les autres libellés", () => {
    const m = message({ labelNames: ["IMPORTANT", "En cours/RH", ""] });
    expect(looksLikeInvoiceMessage(m)).toBe(false);
  });
});

describe("pickInvoicePdfs", () => {
  const ref = (filename: string, mimeType: string, size = 50_000) => ({
    attachmentId: filename,
    filename,
    mimeType,
    size,
  });

  it("garde les PDF envoyés en octet-stream (Stripe)", () => {
    const refs = [ref("Invoice-KHJPXD-00012.pdf", "application/octet-stream")];
    expect(pickInvoicePdfs(refs)).toHaveLength(1);
  });

  it("garde un PDF sans extension si le mimeType le dit", () => {
    expect(pickInvoicePdfs([ref("facture", "application/pdf")])).toHaveLength(1);
  });

  it("écarte les non-PDF, les vides et les trop gros", () => {
    const refs = [
      ref("logo.png", "image/png"),
      ref("vide.pdf", "application/pdf", 0),
      ref("enorme.pdf", "application/pdf", 21 * 1024 * 1024),
    ];
    expect(pickInvoicePdfs(refs)).toEqual([]);
  });
});
