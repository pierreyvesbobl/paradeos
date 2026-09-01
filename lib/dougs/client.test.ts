import { describe, expect, it } from "vitest";
import { parseDougsAgingBuckets, pickDougsPaymentHint, sumDougsAging } from "./client";

/**
 * Ces deux parseurs lisent des payloads Dougs dont le schéma n'est ni
 * documenté ni figé (API interne). Ils doivent donc être tolérants :
 * une forme inattendue renvoie null / [] et jamais une exception, sinon
 * c'est toute la page Relances qui tombe.
 */

describe("pickDougsPaymentHint", () => {
  const inbound = {
    operationCandidate: {
      id: 1,
      operation: {
        id: 4242,
        date: "2026-08-14",
        amount: 1200,
        wording: "VIR SEPA ACME SAS",
        isInbound: true,
        signedAmount: 1200,
      },
    },
  };

  it("extrait un encaissement candidat", () => {
    expect(pickDougsPaymentHint(inbound)).toEqual({
      operationId: 4242,
      date: "2026-08-14",
      amount: 1200,
      wording: "VIR SEPA ACME SAS",
    });
  });

  it("ignore un décaissement (avoir remboursé)", () => {
    const outbound = {
      operationCandidate: {
        id: 2,
        operation: { id: 9, date: "2026-08-14", amount: 300, isInbound: false, signedAmount: -300 },
      },
    };
    expect(pickDougsPaymentHint(outbound)).toBeNull();
  });

  it("déduit le sens depuis signedAmount quand isInbound manque", () => {
    const noFlag = {
      operationCandidate: {
        id: 3,
        operation: { id: 10, date: "2026-08-14", amount: 500, signedAmount: 500 },
      },
    };
    expect(pickDougsPaymentHint(noFlag)?.amount).toBe(500);

    const negative = {
      operationCandidate: {
        id: 4,
        operation: { id: 11, date: "2026-08-14", amount: 500, signedAmount: -500 },
      },
    };
    expect(pickDougsPaymentHint(negative)).toBeNull();
  });

  it("ignore une opération supprimée ou exclue", () => {
    expect(
      pickDougsPaymentHint({
        operationCandidate: {
          id: 5,
          operation: { id: 12, date: "x", amount: 1, isInbound: true, deleted: true },
        },
      }),
    ).toBeNull();
    expect(
      pickDougsPaymentHint({
        operationCandidate: {
          id: 6,
          operation: { id: 13, date: "x", amount: 1, isInbound: true, excluded: true },
        },
      }),
    ).toBeNull();
  });

  it("renvoie null sur absence ou forme inattendue", () => {
    expect(pickDougsPaymentHint({})).toBeNull();
    expect(pickDougsPaymentHint({ operationCandidate: null })).toBeNull();
    expect(pickDougsPaymentHint({ operationCandidate: "nope" })).toBeNull();
    expect(pickDougsPaymentHint({ operationCandidate: { id: 1 } })).toBeNull();
  });
});

describe("parseDougsAgingBuckets", () => {
  it("lit la forme tableau", () => {
    const buckets = parseDougsAgingBuckets([
      { label: "0-30", amount: 1000 },
      { name: "30-60", total: 500 },
    ]);
    expect(buckets).toEqual([
      { label: "0-30", amount: 1000 },
      { label: "30-60", amount: 500 },
    ]);
    expect(sumDougsAging(buckets)).toBe(1500);
  });

  it("lit la forme dictionnaire, valeurs plates ou imbriquées", () => {
    expect(parseDougsAgingBuckets({ "0-30": 100, "30-60": { amount: 200 } })).toEqual([
      { label: "0-30", amount: 100 },
      { label: "30-60", amount: 200 },
    ]);
  });

  it("écarte les entrées sans montant exploitable plutôt que de lever", () => {
    expect(parseDougsAgingBuckets([{ label: "0-30" }, null, "bruit", { amount: 42 }])).toEqual([
      { label: "—", amount: 42 },
    ]);
    expect(parseDougsAgingBuckets({ "0-30": Number.NaN })).toEqual([]);
  });

  it("renvoie [] sur null / undefined / scalaire", () => {
    expect(parseDougsAgingBuckets(null)).toEqual([]);
    expect(parseDougsAgingBuckets(undefined)).toEqual([]);
    expect(parseDougsAgingBuckets(7)).toEqual([]);
  });
});
