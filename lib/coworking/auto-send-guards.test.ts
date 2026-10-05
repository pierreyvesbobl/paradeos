import { describe, expect, it } from "vitest";
import { autoSendPlan } from "./auto-send-guards";

/**
 * Ces gardes sont la seule chose qui empêche une facture définitive de partir
 * chez un client par erreur. Une garde manquante ne se rattrape pas : une
 * facture finalisée ne s'annule que par un avoir. D'où la couverture cas par
 * cas, y compris l'ordre de priorité.
 */

const green = {
  enabled: true,
  contractAutoSend: true,
  billedBy: "parade" as string | null,
  autoSentAt: null as Date | null,
  dougsStatus: null as string | null,
  amountHt: 599,
  recipientEmail: "coworker@example.com" as string | null,
};

/** Raccourci de lecture : la raison du skip, ou le `kind` du plan. */
function verdict(args: Parameters<typeof autoSendPlan>[0]): string {
  const p = autoSendPlan(args);
  return p.kind === "skip" ? p.reason : p.kind;
}

describe("autoSendPlan", () => {
  it("déroule tout le flux quand rien ne s'y oppose", () => {
    expect(verdict(green)).toBe("full");
  });

  it("bloque sur l'interrupteur global", () => {
    expect(verdict({ ...green, enabled: false })).toBe("disabled");
  });

  it("bloque sur un contrat qui n'a pas opt-in", () => {
    expect(verdict({ ...green, contractAutoSend: false })).toBe("not_opted_in");
  });

  it("n'émet jamais une facture G&O", () => {
    expect(verdict({ ...green, billedBy: "g_and_o" })).toBe("g_and_o");
  });

  it("laisse passer un billedBy absent", () => {
    // Les factures d'avant l'arrivée du champ n'ont rien dedans.
    expect(verdict({ ...green, billedBy: null })).toBe("full");
  });

  it("ne renvoie pas une facture déjà émise ET envoyée", () => {
    expect(verdict({ ...green, autoSentAt: new Date() })).toBe("already_sent");
  });

  it("refuse un montant nul, négatif ou non numérique", () => {
    expect(verdict({ ...green, amountHt: 0 })).toBe("zero_amount");
    expect(verdict({ ...green, amountHt: -10 })).toBe("zero_amount");
    expect(verdict({ ...green, amountHt: Number.NaN })).toBe("zero_amount");
  });

  it("refuse l'envoi sans destinataire", () => {
    expect(verdict({ ...green, recipientEmail: null })).toBe("no_recipient");
    expect(verdict({ ...green, recipientEmail: "" })).toBe("no_recipient");
  });

  it("laisse passer un brouillon déjà poussé, quelle que soit la casse", () => {
    expect(verdict({ ...green, dougsStatus: "DRAFT" })).toBe("full");
    expect(verdict({ ...green, dougsStatus: "draft" })).toBe("full");
  });

  describe("facture déjà finalisée mais mail jamais parti", () => {
    // Le cas rencontré en vrai : `send-email` a répondu 400 après un finalize
    // réussi. Refinaliser créerait un second document numéroté pour la même
    // période — il ne reste que le mail à envoyer.
    it("ne refinalise pas, se contente du mail", () => {
      expect(verdict({ ...green, dougsStatus: "WAITING" })).toBe("email_only");
      expect(verdict({ ...green, dougsStatus: "PAID" })).toBe("email_only");
      expect(verdict({ ...green, dougsStatus: "late" })).toBe("email_only");
    });

    it("ne tente rien si le mail est déjà parti", () => {
      expect(verdict({ ...green, dougsStatus: "WAITING", autoSentAt: new Date() })).toBe(
        "already_sent",
      );
    });

    it("exige quand même un destinataire", () => {
      expect(verdict({ ...green, dougsStatus: "WAITING", recipientEmail: null })).toBe(
        "no_recipient",
      );
    });

    it("reste muet sur un contrat non opt-in", () => {
      expect(verdict({ ...green, dougsStatus: "WAITING", contractAutoSend: false })).toBe(
        "not_opted_in",
      );
    });
  });

  it("répond par la raison la plus en amont", () => {
    // Tout est cassé : c'est l'interrupteur global qu'on signale, parce que
    // c'est la première chose à regarder.
    expect(
      verdict({
        enabled: false,
        contractAutoSend: false,
        billedBy: "g_and_o",
        autoSentAt: new Date(),
        dougsStatus: "PAID",
        amountHt: 0,
        recipientEmail: null,
      }),
    ).toBe("disabled");

    // Global ouvert mais contrat non opt-in : c'est le contrat qu'on signale,
    // avant le G&O.
    expect(verdict({ ...green, contractAutoSend: false, billedBy: "g_and_o" })).toBe(
      "not_opted_in",
    );

    // Le montant nul passe avant l'absence de destinataire : corriger le
    // montant est la première chose à faire.
    expect(verdict({ ...green, amountHt: 0, recipientEmail: null })).toBe("zero_amount");
  });
});
