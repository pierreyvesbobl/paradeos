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

describe("similarityInvoiceToPaymentDate — quelques jours autour du débit", () => {
  it("donne le plein score à quelques jours de part et d'autre", () => {
    expect(similarityInvoiceToPaymentDate("2026-03-01", "2026-03-01")).toBe(1);
    expect(similarityInvoiceToPaymentDate("2026-03-01", "2026-03-11")).toBe(1);
    // Quittance d'assurance datée une semaine après le prélèvement.
    expect(similarityInvoiceToPaymentDate("2026-10-09", "2026-10-02")).toBe(1);
  });

  it("décroît quand le paiement s'éloigne, et s'annule avant un mois", () => {
    const at20 = similarityInvoiceToPaymentDate("2026-03-01", "2026-03-21");
    expect(at20).toBeGreaterThan(0);
    expect(at20).toBeLessThan(1);
    // La facture du mois précédent d'un abonnement mensuel ne compte plus.
    expect(similarityInvoiceToPaymentDate("2026-03-01", "2026-03-31")).toBe(0);
    expect(similarityInvoiceToPaymentDate("2026-01-01", "2026-06-01")).toBe(0);
  });

  it("est sévère quand la facture est bien postérieure au débit", () => {
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

  it("départage un abonnement mensuel par la date : la facture du mois courant l'emporte", () => {
    // Cas réel : OpenRouter, Supabase, Stello… même montant chaque mois.
    // Le montant ne distingue pas les mois, la proximité de date si.
    const ranked = rankMatchesForOperation(
      op({ wording: "OPENROUTER, INC", amount: -22.07, date: "2026-09-16" }),
      [
        doc({ supplierKey: "openrouter", amountTtc: 22.07, invoiceDate: "2026-07-07" }),
        doc({ supplierKey: "openrouter", amountTtc: 22.07, invoiceDate: "2026-08-16" }),
        doc({ supplierKey: "openrouter", amountTtc: 22.07, invoiceDate: "2026-09-16" }),
      ],
      read,
    );
    expect(ranked[0]?.document.invoiceDate).toBe("2026-09-16");
    expect(ranked[0]?.confidence).toBe("certain");
    expect(ranked.slice(1).every((r) => r.confidence === "probable")).toBe(true);
  });

  it("attache une quittance datée quelques jours après le prélèvement", () => {
    const ranked = rankMatchesForOperation(
      op({ wording: "EASYBEE SAS - STELLO Assurances", amount: -17.9, date: "2026-10-02" }),
      [
        doc({ supplierKey: "stello", amountTtc: 17.9, invoiceDate: "2026-09-09" }),
        doc({ supplierKey: "stello", amountTtc: 17.9, invoiceDate: "2026-10-09" }),
      ],
      read,
    );
    expect(ranked[0]?.document.invoiceDate).toBe("2026-10-09");
    expect(ranked[0]?.confidence).toBe("certain");
  });

  it("sépare deux contrats du même assureur prélevés le même jour par le montant", () => {
    // Stello : RC Pro à 17,90 € et assurance du local à 40,26 €, même
    // libellé bancaire, même date. Un candidat à un autre montant n'est
    // pas une alternative — chaque débit trouve sa quittance.
    const docs = [
      doc({ supplierKey: "stello", amountTtc: 17.9, invoiceDate: "2026-10-09" }),
      doc({ supplierKey: "stello", amountTtc: 40.26, invoiceDate: "2026-10-09" }),
    ];
    const rcPro = rankMatchesForOperation(
      op({ wording: "EASYBEE SAS - STELLO Assurances", amount: -17.9, date: "2026-10-02" }),
      docs,
      read,
    );
    const local = rankMatchesForOperation(
      op({ wording: "EASYBEE SAS - STELLO Assurances", amount: -40.26, date: "2026-10-02" }),
      docs,
      read,
    );
    expect(rcPro[0]?.document.amountTtc).toBe(17.9);
    expect(rcPro[0]?.confidence).toBe("certain");
    expect(local[0]?.document.amountTtc).toBe(40.26);
    expect(local[0]?.confidence).toBe("certain");
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
