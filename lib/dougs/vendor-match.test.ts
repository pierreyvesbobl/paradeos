import { describe, expect, it } from "vitest";
import {
  type DocumentSide,
  type OperationSide,
  rankMatchesForOperation,
  scoreOperationDocument,
  similarityInvoiceToPaymentDate,
  wordingToSupplierKey,
} from "./vendor-match";

function op(overrides: Partial<OperationSide> = {}): OperationSide {
  return { amount: -12, date: "2026-03-10", wording: "PRLV SEPA OVH", ...overrides };
}

function doc(overrides: Partial<DocumentSide> = {}): DocumentSide {
  return { amountTtc: 12, invoiceDate: "2026-03-01", supplierKey: "ovh", ...overrides };
}

describe("wordingToSupplierKey — décrasser un libellé bancaire", () => {
  it.each([
    ["PRLV SEPA OVH SAS 1234", "ovh"],
    ["CB MAXICOFFEE 15/03", "maxicoffee"],
    ["ACHAT CB ELEVENLABS.IO", "elevenlabs"],
    ["PAIEMENT CB 0912 AMAZON", "amazon"],
    ["PRELEVEMENT EUROPEEN HOSTINGER", "hostinger"],
    ["VIR SEPA SUPABASE PTE LTD", "supabase"],
    ["CARTE 12/03/26 GOOGLE CLOUD", "googlecloud"],
  ])("« %s » → %s", (wording, expected) => {
    expect(wordingToSupplierKey(wording)).toBe(expected);
  });

  it.each([[""], [null], ["PRLV SEPA"], ["VIREMENT 12345678"]])(
    "ne devine rien à partir de « %s »",
    (wording) => {
      expect(wordingToSupplierKey(wording)).toBe("");
    },
  );
});

describe("similarityInvoiceToPaymentDate — la facture précède le paiement", () => {
  it("donne le plein score sur la fenêtre normale de prélèvement", () => {
    expect(similarityInvoiceToPaymentDate("2026-03-01", "2026-03-01")).toBe(1);
    expect(similarityInvoiceToPaymentDate("2026-03-01", "2026-03-31")).toBe(1);
    expect(similarityInvoiceToPaymentDate("2026-03-01", "2026-04-15")).toBe(1);
  });

  it("décroît quand le paiement s'éloigne, et s'annule à 120 jours", () => {
    const at60 = similarityInvoiceToPaymentDate("2026-01-01", "2026-03-02");
    expect(at60).toBeGreaterThan(0);
    expect(at60).toBeLessThan(1);
    expect(similarityInvoiceToPaymentDate("2026-01-01", "2026-06-01")).toBe(0);
  });

  it("est sévère quand la facture est postérieure au débit", () => {
    // Facture datée 20 jours APRÈS le paiement : ce n'est pas la bonne.
    expect(similarityInvoiceToPaymentDate("2026-03-20", "2026-02-28")).toBe(0);
  });

  it("rend 0 quand une date manque", () => {
    expect(similarityInvoiceToPaymentDate(null, "2026-03-01")).toBe(0);
    expect(similarityInvoiceToPaymentDate("2026-03-01", null)).toBe(0);
  });
});

describe("scoreOperationDocument", () => {
  it("reconnaît un prélèvement et sa facture", () => {
    const score = scoreOperationDocument(op(), doc());
    expect(score.amountExact).toBe(true);
    expect(score.total).toBeGreaterThan(0.9);
  });

  it("compare des valeurs absolues : le débit est négatif, la facture positive", () => {
    expect(
      scoreOperationDocument(op({ amount: -131.5 }), doc({ amountTtc: 131.5 })).amountExact,
    ).toBe(true);
  });

  it("un montant parfait ne suffit pas si le fournisseur ne correspond pas", () => {
    // La régression que le plancher existe pour empêcher : deux
    // abonnements mensuels au même prix, chez deux fournisseurs.
    const score = scoreOperationDocument(
      op({ wording: "PRLV SEPA ADOBE" }),
      doc({ supplierKey: "midjourney" }),
    );
    expect(score.rejectedOnSupplier).toBe(true);
    expect(score.total).toBe(0);
  });

  it("ne rapproche rien d'un virement interne sans nom lisible", () => {
    expect(scoreOperationDocument(op({ wording: "VIR SEPA 8891234" }), doc()).total).toBe(0);
  });

  it("tolère les variantes de raison sociale", () => {
    const score = scoreOperationDocument(
      op({ wording: "ACHAT CB ELEVENLABS.IO", amount: -5 }),
      doc({ supplierKey: "elevenlabs", amountTtc: 5 }),
    );
    expect(score.supplier).toBeGreaterThan(0.9);
  });
});

describe("rankMatchesForOperation — quand peut-on attacher sans demander", () => {
  const read = (d: DocumentSide) => d;

  it("attache tout seul quand un seul document concorde", () => {
    const ranked = rankMatchesForOperation(op(), [doc()], read);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.confidence).toBe("certain");
  });

  it("refuse d'attacher quand deux factures du même fournisseur ont le même montant", () => {
    // Cas réel : 32 factures ElevenLabs, beaucoup à 5 $, parfois deux
    // dans le même mois. Le montant ne départage pas → validation manuelle.
    const ranked = rankMatchesForOperation(
      op({ wording: "ACHAT CB ELEVENLABS", amount: -5, date: "2026-03-20" }),
      [
        doc({ supplierKey: "elevenlabs", amountTtc: 5, invoiceDate: "2026-03-02" }),
        doc({ supplierKey: "elevenlabs", amountTtc: 5, invoiceDate: "2026-03-05" }),
      ],
      read,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => r.confidence === "probable")).toBe(true);
  });

  it("n'attache pas tout seul un loyer trimestriel sur un prélèvement mensuel", () => {
    // Une facture de loyer de 3 600 € couvre trois débits de 1 200 €.
    // Les montants ne coïncident pas : à l'humain de rattacher.
    const ranked = rankMatchesForOperation(
      op({ wording: "PRLV SEPA SCI FLV", amount: -1200, date: "2026-04-05" }),
      [doc({ supplierKey: "flv", amountTtc: 3600, invoiceDate: "2026-04-01" })],
      read,
    );
    expect(ranked[0]?.confidence).not.toBe("certain");
  });

  it("n'attache pas tout seul sans date de facture exploitable", () => {
    const ranked = rankMatchesForOperation(op(), [doc({ invoiceDate: null })], read);
    expect(ranked[0]?.confidence).not.toBe("certain");
  });

  it("écarte les documents sous le seuil de proposition", () => {
    const ranked = rankMatchesForOperation(
      op({ wording: "PRLV SEPA OVH", amount: -12 }),
      [doc({ supplierKey: "adobe", amountTtc: 599 })],
      read,
    );
    expect(ranked).toHaveLength(0);
  });

  it("classe le meilleur candidat en tête et borne la liste", () => {
    const ranked = rankMatchesForOperation(
      op({ wording: "PRLV SEPA OVH", amount: -12, date: "2026-03-10" }),
      [
        doc({ amountTtc: 12.5, invoiceDate: "2026-02-01" }),
        doc({ amountTtc: 12, invoiceDate: "2026-03-01" }),
        doc({ amountTtc: 11.8, invoiceDate: "2026-01-15" }),
        doc({ amountTtc: 12.2, invoiceDate: "2026-02-20" }),
        doc({ amountTtc: 12.4, invoiceDate: "2026-02-10" }),
      ],
      read,
      { limit: 3 },
    );
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.score.amountExact).toBe(true);
  });
});
