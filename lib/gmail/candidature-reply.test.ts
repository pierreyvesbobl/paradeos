import { describe, expect, it } from "vitest";
import {
  candidatureReplySubject,
  DEFAULT_CANDIDATURE_REPLY_BODY,
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
});
