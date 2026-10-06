import { describe, expect, it } from "vitest";
import { assertPreviewed, messageDigest } from "./preview-gate";

const SUBJECT = "Notre proposition pour le rapprochement EBP";
const BODY = "Bonjour,\n\nVous trouverez ci-joint notre devis.\n\nBien à vous,";

describe("messageDigest", () => {
  it("ne dépend pas des espaces de bord", () => {
    // Un retour à la ligne de plus ne doit pas invalider un aperçu relu.
    expect(messageDigest(SUBJECT, BODY)).toBe(messageDigest(` ${SUBJECT} `, `${BODY}\n\n`));
  });

  it("change dès que le message change", () => {
    expect(messageDigest(SUBJECT, BODY)).not.toBe(messageDigest(SUBJECT, `${BODY} Merci.`));
    expect(messageDigest(SUBJECT, BODY)).not.toBe(messageDigest(`${SUBJECT} !`, BODY));
  });

  it("ne confond pas un objet déplacé dans le corps", () => {
    // Sans séparateur, "a"+"bc" et "ab"+"c" donneraient la même empreinte.
    expect(messageDigest("a", "bc")).not.toBe(messageDigest("ab", "c"));
  });
});

describe("assertPreviewed", () => {
  const digest = messageDigest(SUBJECT, BODY);

  it("laisse passer un message dont l'aperçu a été relu", () => {
    expect(() =>
      assertPreviewed({
        noun: "devis",
        previewDigest: digest,
        previewSentAt: new Date(),
        digest,
      }),
    ).not.toThrow();
  });

  it("refuse un envoi sans aucun aperçu", () => {
    expect(() =>
      assertPreviewed({ noun: "devis", previewDigest: null, previewSentAt: null, digest }),
    ).toThrow(/aperçu/i);
  });

  it("refuse si le message a changé depuis l'aperçu", () => {
    expect(() =>
      assertPreviewed({
        noun: "facture",
        previewDigest: messageDigest(SUBJECT, "Autre chose"),
        previewSentAt: new Date(),
        digest,
      }),
    ).toThrow(/changé depuis l'aperçu/i);
  });

  it("refuse une empreinte orpheline, sans date d'aperçu", () => {
    // État incohérent : on ne fait pas confiance à une empreinte seule.
    expect(() =>
      assertPreviewed({ noun: "devis", previewDigest: digest, previewSentAt: null, digest }),
    ).toThrow(/aperçu/i);
  });

  it("nomme le document dans le message d'erreur", () => {
    expect(() =>
      assertPreviewed({ noun: "facture", previewDigest: null, previewSentAt: null, digest }),
    ).toThrow(/facture/);
  });
});
