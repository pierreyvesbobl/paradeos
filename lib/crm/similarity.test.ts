import { describe, expect, it } from "vitest";

import { trigramSimilarity, trigrams } from "@/lib/crm/similarity";

describe("trigrams", () => {
  it("encadre chaque mot comme pg_trgm", () => {
    expect([...trigrams("cat")].sort()).toEqual(["  c", " ca", "at ", "cat"].sort());
  });

  it("ignore la ponctuation comme séparateur de mots", () => {
    expect(trigrams("a.b")).toEqual(trigrams("a b"));
  });
});

describe("trigramSimilarity", () => {
  // Valeurs relevées sur la base Paradeos avec `select similarity(…)` :
  // le portage doit rendre les mêmes scores, sinon les seuils calibrés
  // sur pg_trgm ne veulent plus rien dire.
  it("reproduit les scores de pg_trgm", () => {
    expect(trigramSimilarity("mkp doctor", "mkpdoctor")).toBeCloseTo(0.615, 2);
    expect(trigramSimilarity("bobl", "bobl sas")).toBeCloseTo(0.556, 2);
  });

  it("vaut 1 pour deux chaînes identiques", () => {
    expect(trigramSimilarity("flow boreal", "flow boreal")).toBe(1);
  });

  it("vaut 0 quand une chaîne est vide", () => {
    expect(trigramSimilarity("", "flow boreal")).toBe(0);
  });

  it("reste insensible à l'ordre des mots", () => {
    expect(trigramSimilarity("raphael garcia", "garcia raphael")).toBe(1);
  });
});
