import { describe, expect, it } from "vitest";
import {
  candidatureReplySubject,
  DEFAULT_CANDIDATURE_REPLY_BODY,
  DEFAULT_PRESTATAIRE_REPLY_BODY,
  defaultReplyBodyFor,
  renderCandidatureReply,
} from "./candidature-reply";

describe("renderCandidatureReply", () => {
  it("insère le prénom", () => {
    const out = renderCandidatureReply(DEFAULT_CANDIDATURE_REPLY_BODY, "Candice");
    expect(out.startsWith("Bonjour Candice,")).toBe(true);
    expect(out).not.toContain("{prenom}");
  });

  it("retombe sur « Bonjour, » sans prénom", () => {
    const out = renderCandidatureReply(DEFAULT_CANDIDATURE_REPLY_BODY, null);
    expect(out.startsWith("Bonjour,")).toBe(true);
    expect(out).not.toContain("{prenom}");
  });

  it("respecte un gabarit personnalisé", () => {
    expect(renderCandidatureReply("Salut {prenom} !", "Léa")).toBe("Salut Léa !");
  });

  it("le gabarit prestation refuse le renfort, pas le poste", () => {
    const out = renderCandidatureReply(DEFAULT_PRESTATAIRE_REPLY_BODY, "Gael");
    expect(out.startsWith("Bonjour Gael,")).toBe(true);
    expect(out).toContain("sous-traitants");
    expect(out).not.toContain("poste ouvert");
  });
});

describe("defaultReplyBodyFor", () => {
  it("choisit le gabarit selon le type", () => {
    expect(defaultReplyBodyFor("candidature")).toBe(DEFAULT_CANDIDATURE_REPLY_BODY);
    expect(defaultReplyBodyFor("prestation")).toBe(DEFAULT_PRESTATAIRE_REPLY_BODY);
  });
});

describe("candidatureReplySubject", () => {
  it.each([
    ["Candidature spontanée", "Re: Candidature spontanée"],
    ["Re: Candidature spontanée", "Re: Candidature spontanée"],
    ["RE : Candidature", "RE : Candidature"],
    [null, "Re: Votre candidature"],
    ["   ", "Re: Votre candidature"],
  ])("%s → %s", (subject, expected) => {
    expect(candidatureReplySubject(subject)).toBe(expected);
  });

  it("sans sujet, une prestation obtient son propre repli", () => {
    expect(candidatureReplySubject(null, "prestation")).toBe("Re: Votre proposition");
    expect(candidatureReplySubject("Renfort n8n", "prestation")).toBe("Re: Renfort n8n");
  });
});
