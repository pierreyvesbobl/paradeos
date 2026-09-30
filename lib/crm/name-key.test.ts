import { describe, expect, it } from "vitest";

import {
  compactNameKey,
  emailLocalPart,
  normalizeEmail,
  normalizeNameKey,
  personCompactKey,
  personNameKey,
} from "@/lib/crm/name-key";

describe("normalizeNameKey", () => {
  it("retire accents, casse et ponctuation", () => {
    expect(normalizeNameKey("Aparisi Consulting")).toBe("aparisi consulting");
    expect(normalizeNameKey("M.K.P. DOCTOR")).toBe("mkp doctor");
    expect(normalizeNameKey("  Société   Générale  ")).toBe("societe generale");
  });

  it("retire les formes juridiques", () => {
    expect(normalizeNameKey("Bobl SAS")).toBe(normalizeNameKey("Bobl"));
    expect(normalizeNameKey("Nextase SARL")).toBe("nextase");
    expect(normalizeNameKey("Acme Ltd")).toBe("acme");
  });

  it("aligne & et et", () => {
    expect(normalizeNameKey("Dupont & Fils")).toBe(normalizeNameKey("Dupont et Fils"));
  });

  it("ne vide pas une raison sociale composée uniquement de mots filtrés", () => {
    expect(normalizeNameKey("Groupe")).toBe("groupe");
    expect(normalizeNameKey("Le Comptoir")).toBe("comptoir");
    expect(normalizeNameKey("France")).toBe("france");
  });

  it("retourne la chaîne vide pour une entrée sans contenu", () => {
    expect(normalizeNameKey(null)).toBe("");
    expect(normalizeNameKey("   ")).toBe("");
    expect(normalizeNameKey("!!!")).toBe("");
  });
});

describe("compactNameKey", () => {
  it("rapproche un nom collé de sa forme espacée", () => {
    expect(compactNameKey("mkpdoctor")).toBe(compactNameKey("MKP Doctor"));
    expect(compactNameKey("Flow Boreal")).toBe("flowboreal");
  });

  it("distingue deux sociétés réellement différentes", () => {
    expect(compactNameKey("CAD.42 Services")).not.toBe(compactNameKey("QG Services nettoyage"));
  });
});

describe("personNameKey", () => {
  it("normalise les accents d'un nom de famille", () => {
    expect(personNameKey("Julien", "Lacoëntre")).toBe(personNameKey("Julien", "Lacoentre"));
  });

  it("supporte un nom de famille absent", () => {
    expect(personNameKey("Frédéric", null)).toBe("frederic");
    expect(personCompactKey("Raphaël", "Garcia-Brotons")).toBe("raphaelgarciabrotons");
  });
});

describe("email", () => {
  it("normalise la casse", () => {
    expect(normalizeEmail("  PY@Bobl.FR ")).toBe("py@bobl.fr");
  });

  it("extrait la partie locale sans le tag +", () => {
    expect(emailLocalPart("julien.lacoentre+crm@nextase.fr")).toBe("julien.lacoentre");
    expect(emailLocalPart("pas-un-email")).toBe("");
  });
});
