import { describe, expect, it } from "vitest";
import {
  buildLinkedinProfileUrl,
  memberIdFromUrn,
  normalizeLinkedinIdentifier,
  sameLinkedinProfile,
} from "./identity";

describe("normalizeLinkedinIdentifier", () => {
  it("extrait le slug d'une URL canonique", () => {
    expect(normalizeLinkedinIdentifier("https://www.linkedin.com/in/py-sage")).toBe("py-sage");
  });

  it("tolère le slash final, la casse et les paramètres de tracking", () => {
    expect(normalizeLinkedinIdentifier("https://www.linkedin.com/in/PY-Sage/")).toBe("py-sage");
    expect(
      normalizeLinkedinIdentifier("https://www.linkedin.com/in/py-sage/?originalSubdomain=fr"),
    ).toBe("py-sage");
  });

  it("tolère l'absence de protocole et les sous-domaines localisés", () => {
    expect(normalizeLinkedinIdentifier("linkedin.com/in/py-sage")).toBe("py-sage");
    expect(normalizeLinkedinIdentifier("fr.linkedin.com/in/py-sage")).toBe("py-sage");
    expect(normalizeLinkedinIdentifier("http://m.linkedin.com/in/py-sage")).toBe("py-sage");
  });

  it("accepte un slug nu", () => {
    expect(normalizeLinkedinIdentifier("py-sage")).toBe("py-sage");
  });

  it("décode les slugs percent-encodés", () => {
    expect(normalizeLinkedinIdentifier("https://www.linkedin.com/in/b%C3%A9n%C3%A9dicte")).toBe(
      "bénédicte",
    );
  });

  it("refuse les URL LinkedIn qui ne sont pas des profils", () => {
    // Le piège : rattacher une page société à un contact.
    expect(normalizeLinkedinIdentifier("https://www.linkedin.com/company/parade")).toBeNull();
    expect(normalizeLinkedinIdentifier("https://www.linkedin.com/feed/")).toBeNull();
    expect(normalizeLinkedinIdentifier("company")).toBeNull();
  });

  it("renvoie null sur les entrées vides ou inexploitables", () => {
    expect(normalizeLinkedinIdentifier(null)).toBeNull();
    expect(normalizeLinkedinIdentifier(undefined)).toBeNull();
    expect(normalizeLinkedinIdentifier("   ")).toBeNull();
    expect(normalizeLinkedinIdentifier("Pierre-Yves Sage")).toBeNull();
  });
});

describe("sameLinkedinProfile", () => {
  it("rapproche deux écritures différentes du même profil", () => {
    expect(
      sameLinkedinProfile("https://fr.linkedin.com/in/PY-Sage/", "linkedin.com/in/py-sage"),
    ).toBe(true);
  });

  it("ne rapproche jamais deux valeurs non identifiables", () => {
    // Sans ce garde-fou, deux contacts sans URL se retrouveraient fusionnés.
    expect(sameLinkedinProfile(null, null)).toBe(false);
    expect(sameLinkedinProfile("", "")).toBe(false);
  });
});

describe("buildLinkedinProfileUrl", () => {
  it("canonicalise n'importe quelle écriture", () => {
    expect(buildLinkedinProfileUrl("fr.linkedin.com/in/PY-Sage/")).toBe(
      "https://www.linkedin.com/in/py-sage",
    );
  });

  it("renvoie null si rien d'identifiable", () => {
    expect(buildLinkedinProfileUrl("")).toBeNull();
  });
});

describe("memberIdFromUrn", () => {
  it("extrait l'identifiant d'une URN Voyager", () => {
    expect(memberIdFromUrn("urn:li:fsd_profile:ACoAAABcDeF")).toBe("ACoAAABcDeF");
  });

  it("renvoie null quand ce n'est pas une URN", () => {
    expect(memberIdFromUrn("ACoAAABcDeF")).toBeNull();
    expect(memberIdFromUrn(null)).toBeNull();
  });
});
