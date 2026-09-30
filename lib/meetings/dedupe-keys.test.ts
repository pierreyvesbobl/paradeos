import { describe, expect, it } from "vitest";
import { meetingTitleKey, transcriptFingerprint } from "./dedupe-keys";

const TRANSCRIPT =
  "Pierre-Yves : on valide le devis GpasPlus cette semaine.\nBadr : je relance le client demain matin.";

describe("transcriptFingerprint", () => {
  it("ignore la mise en forme des blancs", () => {
    // Un export Drive et un export Gmail du même texte ne replient pas
    // les retours à la ligne pareil : ça ne doit pas faire deux réunions.
    const a = transcriptFingerprint(TRANSCRIPT);
    const b = transcriptFingerprint(`\n  ${TRANSCRIPT.replace(/\n/g, "\r\n  ")}   \n`);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it("distingue deux transcripts différents", () => {
    expect(transcriptFingerprint(TRANSCRIPT)).not.toBe(
      transcriptFingerprint(`${TRANSCRIPT} On se rappelle vendredi.`),
    );
  });

  it("ne signe pas ce qui est trop court pour prouver un doublon", () => {
    expect(transcriptFingerprint("Bonjour.")).toBeNull();
    expect(transcriptFingerprint("")).toBeNull();
    expect(transcriptFingerprint(null)).toBeNull();
  });
});

describe("meetingTitleKey", () => {
  it("ignore accents, casse et ponctuation", () => {
    expect(meetingTitleKey("Réunion — GpasPlus (v2)")).toBe(meetingTitleKey("reunion gpasplus v2"));
  });

  it("ne confond pas deux titres qui ne diffèrent que par un mot", () => {
    // `normalizeNameKey` retirerait « France » comme suffixe de raison
    // sociale : ce n'est pas ce qu'on veut sur un titre de réunion.
    expect(meetingTitleKey("Point France")).not.toBe(meetingTitleKey("Point"));
  });

  it("rend une clé vide sur un titre sans matière", () => {
    expect(meetingTitleKey("   ")).toBe("");
    expect(meetingTitleKey(null)).toBe("");
  });
});
