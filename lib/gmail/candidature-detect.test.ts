import { describe, expect, it } from "vitest";
import {
  firstNameFromSender,
  isOwnOrAutomatedSender,
  looksLikeCandidatureMessage,
} from "./candidature-detect";

function message(overrides: Partial<Parameters<typeof looksLikeCandidatureMessage>[0]>) {
  return { subject: null, fromEmail: "someone@gmail.com", labelNames: [], ...overrides };
}

describe("looksLikeCandidatureMessage", () => {
  it.each([
    "Candidature spontanée — Product Builder no-code / automatisation IA",
    "Re: Candidature – Alternance en développement web & automatisation",
    "Demande d'opportunités de stage de fin d'études (SFE) chez Automato",
    "Stage de fin d'études, IA appliquée, décembre 2026",
    "Recherche d'alternance en data",
    "Mon CV pour votre agence",
    "Internship application - AI engineer",
    "Job application: automation specialist",
  ])("détecte le sujet « %s »", (subject) => {
    expect(looksLikeCandidatureMessage(message({ subject }))).toBe(true);
  });

  it.each([
    "Demande devis formation",
    "Stage de formation Make du 12 mars",
    "Poste de travail coworking",
    "Re: Suite à la présentation d'Automato",
    "Votre facture d'hébergement",
    "Point projet + prochaines étapes",
  ])("ignore le sujet « %s »", (subject) => {
    expect(looksLikeCandidatureMessage(message({ subject }))).toBe(false);
  });

  it("détecte via le libellé Gmail de recrutement", () => {
    expect(
      looksLikeCandidatureMessage(message({ subject: "Bonjour", labelNames: ["En cours/RH"] })),
    ).toBe(true);
    expect(
      looksLikeCandidatureMessage(
        message({ subject: "Bonjour", labelNames: ["Paradeos/Projets/RH Tool"] }),
      ),
    ).toBe(false);
  });

  it("ne répond jamais à nos propres boîtes ni aux automates", () => {
    expect(
      looksLikeCandidatureMessage(
        message({ subject: "Candidature", fromEmail: "pierreyves@automato.tech" }),
      ),
    ).toBe(false);
    expect(
      looksLikeCandidatureMessage(
        message({ subject: "Candidature", fromEmail: "noreply@jobboard.com" }),
      ),
    ).toBe(false);
    expect(looksLikeCandidatureMessage(message({ subject: "Candidature", fromEmail: null }))).toBe(
      false,
    );
  });
});

describe("isOwnOrAutomatedSender", () => {
  it.each(["hello@automato.tech", "benoit@bobl.fr", "no-reply@linkedin.com", "notifications@x.io"])(
    "exclut %s",
    (email) => {
      expect(isOwnOrAutomatedSender(email)).toBe(true);
    },
  );
  it("garde un candidat ordinaire", () => {
    expect(isOwnOrAutomatedSender("candice20.dupuis@gmail.com")).toBe(false);
  });
});

describe("firstNameFromSender", () => {
  it.each([
    ["Candice DUPUIS", "Candice"],
    ["DUPUIS Candice", "Candice"],
    ["florian honoré", "Florian"],
    ["mohamed", "Mohamed"],
  ])("« %s » → %s", (name, expected) => {
    expect(firstNameFromSender(name)).toBe(expected);
  });
  it("renvoie null sans nom exploitable", () => {
    expect(firstNameFromSender(null)).toBeNull();
    expect(firstNameFromSender("candice20.dupuis@gmail.com")).toBeNull();
    expect(firstNameFromSender("")).toBeNull();
  });
});
