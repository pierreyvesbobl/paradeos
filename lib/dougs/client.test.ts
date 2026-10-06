import { describe, expect, it } from "vitest";
import {
  parseDougsAgingBuckets,
  parseDougsFinalizeBlockers,
  pickDougsFileUuid,
  pickDougsPaymentHint,
  pickDougsSalesInvoiceId,
  sumDougsAging,
} from "./client";

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

/**
 * `can-finalize` garde la porte de la seule opération irréversible de l'app.
 * Sa forme n'a pas pu être vérifiée en live (Dougs répond 401 hors Vercel),
 * donc le parseur doit être tolérant **sans jamais** conclure « pas de
 * bloqueur » sur une réponse qu'il n'a pas comprise : finaliser à l'aveugle
 * émettrait une facture fausse qu'il faudrait annuler par un avoir.
 */
describe("parseDougsFinalizeBlockers", () => {
  it("lit la forme documentée", () => {
    expect(
      parseDougsFinalizeBlockers([
        { field: "legalName", message: "Vous devez renseigner le nom de la société du client." },
        { field: "address", message: "Vous devez renseigner l'adresse du client." },
      ]),
    ).toEqual([
      { field: "legalName", message: "Vous devez renseigner le nom de la société du client." },
      { field: "address", message: "Vous devez renseigner l'adresse du client." },
    ]);
  });

  it("considère un tableau vide comme « prêt à finaliser »", () => {
    expect(parseDougsFinalizeBlockers([])).toEqual([]);
  });

  it("considère null et la chaîne vide comme « prêt »", () => {
    expect(parseDougsFinalizeBlockers(null)).toEqual([]);
    expect(parseDougsFinalizeBlockers(undefined)).toEqual([]);
    expect(parseDougsFinalizeBlockers("")).toEqual([]);
  });

  it("déballe un tableau emballé dans un objet", () => {
    expect(
      parseDougsFinalizeBlockers({ errors: [{ field: "lines", message: "Ligne sans prix." }] }),
    ).toEqual([{ field: "lines", message: "Ligne sans prix." }]);
    expect(parseDougsFinalizeBlockers({ blockers: [] })).toEqual([]);
    expect(parseDougsFinalizeBlockers({ data: null })).toEqual([]);
  });

  it("accepte des entrées réduites à une chaîne", () => {
    expect(parseDougsFinalizeBlockers(["Adresse manquante."])).toEqual([
      { field: "_", message: "Adresse manquante." },
    ]);
  });

  it("comble un bloqueur sans message", () => {
    expect(parseDougsFinalizeBlockers([{ field: "siren" }])).toEqual([
      { field: "siren", message: "Blocage non détaillé par Dougs." },
    ]);
    expect(parseDougsFinalizeBlockers([{ error: "TVA invalide" }])).toEqual([
      { field: "_", message: "TVA invalide" },
    ]);
  });

  it("refuse de finaliser quand la réponse est illisible", () => {
    // C'est le cas qui compte : ne JAMAIS renvoyer [] par défaut.
    expect(parseDougsFinalizeBlockers(42)).toHaveLength(1);
    expect(parseDougsFinalizeBlockers(42)[0]?.field).toBe("_unknown");
    expect(parseDougsFinalizeBlockers({ statut: "ok" })).toHaveLength(1);
    expect(parseDougsFinalizeBlockers({ errors: "pas un tableau" })).toHaveLength(1);
  });

  it("ne lève jamais", () => {
    for (const input of [{}, [null], [undefined], true, Number.NaN, { errors: {} }]) {
      expect(() => parseDougsFinalizeBlockers(input)).not.toThrow();
    }
  });
});

/**
 * Le PDF légal est joint à nos propres mails : si on ne sait pas en extraire
 * l'UUID, le client reçoit un mail sans sa facture.
 */
describe("pickDougsFileUuid", () => {
  const uuid = "cf07bd01-497e-455f-b144-84c038bf457b";

  it("lit l'UUID dans filePath", () => {
    expect(pickDougsFileUuid({ filePath: `/files/${uuid}/actions/download` })).toBe(uuid);
  });

  it("accepte pdfFileId quand il a la forme d'un UUID", () => {
    expect(pickDougsFileUuid({ pdfFileId: uuid })).toBe(uuid);
  });

  it("ignore un fileId numérique, qui n'est pas exploitable", () => {
    expect(pickDougsFileUuid({ fileId: 12345 })).toBeNull();
  });

  it("préfère filePath aux autres champs", () => {
    expect(
      pickDougsFileUuid({
        filePath: `/files/${uuid}/actions/download`,
        pdfFileId: "11111111-2222-3333-4444-555555555555",
      }),
    ).toBe(uuid);
  });

  it("renvoie null plutôt que de deviner", () => {
    expect(pickDougsFileUuid({})).toBeNull();
    expect(pickDougsFileUuid({ filePath: "/files/pas-un-uuid/actions/download" })).toBeNull();
  });
});

/**
 * Deux identifiants se ressemblent et ne désignent pas le même objet : prendre
 * celui du brouillon pour celui de la facture émise fait répondre 404 à
 * `send-email`, donc une facture finalisée que le client ne reçoit jamais.
 */
describe("pickDougsSalesInvoiceId", () => {
  const draft = "32656ec4-629f-42b2-9233-62d980cdcba3";
  const invoice = "52ec2e30-471b-402f-86d3-3c3ca880a9e8";

  it("préfère salesInvoiceId à l'id du brouillon", () => {
    expect(pickDougsSalesInvoiceId({ id: draft, salesInvoiceId: invoice })).toBe(invoice);
  });

  it("retombe sur id quand salesInvoiceId manque", () => {
    expect(pickDougsSalesInvoiceId({ id: draft })).toBe(draft);
  });

  it("ignore un salesInvoiceId qui n'est pas un UUID", () => {
    expect(pickDougsSalesInvoiceId({ id: draft, salesInvoiceId: null })).toBe(draft);
    expect(pickDougsSalesInvoiceId({ id: draft, salesInvoiceId: 12345 })).toBe(draft);
    expect(pickDougsSalesInvoiceId({ id: draft, salesInvoiceId: "" })).toBe(draft);
  });

  it("renvoie null plutôt que de deviner", () => {
    expect(pickDougsSalesInvoiceId({})).toBeNull();
    expect(pickDougsSalesInvoiceId({ id: "pas-un-uuid" })).toBeNull();
  });
});
