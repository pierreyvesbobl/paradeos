import { describe, expect, it } from "vitest";
import { parseDirectiveDate, parseEmailContext } from "./email-directives";

const TODAY = new Date(Date.UTC(2026, 8, 29, 12));

describe("parseDirectiveDate", () => {
  it("lit le format français et l'ISO", () => {
    expect(parseDirectiveDate("12/03/2026")?.toISOString()).toBe("2026-03-12T12:00:00.000Z");
    expect(parseDirectiveDate("2026-03-12")?.toISOString()).toBe("2026-03-12T12:00:00.000Z");
    expect(parseDirectiveDate("12.03.26")?.toISOString()).toBe("2026-03-12T12:00:00.000Z");
  });

  it("complète l'année manquante par l'année en cours", () => {
    expect(parseDirectiveDate("12/03", TODAY)?.toISOString()).toBe("2026-03-12T12:00:00.000Z");
  });

  it("refuse une date qui n'existe pas plutôt que de la replier", () => {
    expect(parseDirectiveDate("31/02/2026")).toBeNull();
    expect(parseDirectiveDate("12/13/2026")).toBeNull();
    expect(parseDirectiveDate("la semaine dernière")).toBeNull();
  });
});

describe("parseEmailContext — objet", () => {
  it("sort les directives du titre", () => {
    const ctx = parseEmailContext(
      "Point hebdo [projet: GpasPlus] [avec: Marie Testard, Éric]",
      "",
      TODAY,
    );
    expect(ctx.subject).toBe("Point hebdo");
    expect(ctx.projectHint).toBe("GpasPlus");
    expect(ctx.participants).toEqual([
      { name: "Marie Testard", email: null },
      { name: "Éric", email: null },
    ]);
  });

  it("laisse en place ce qui ressemble à une directive sans en être une", () => {
    const ctx = parseEmailContext("Compte-rendu [confidentiel: interne]", "", TODAY);
    expect(ctx.subject).toBe("Compte-rendu [confidentiel: interne]");
    expect(ctx.projectHint).toBeNull();
  });
});

describe("parseEmailContext — corps", () => {
  it("lit l'entête et le retire du transcript", () => {
    const body = [
      "Projet : GpasPlus - Automatisation",
      "Participants : Marie Testard <marie@fictiva.fr>, Éric",
      "Date : 12/03/2026",
      "",
      "Marie : on valide le devis.",
      "Éric : je relance lundi.",
    ].join("\n");
    const ctx = parseEmailContext("Point hebdo", body, TODAY);
    expect(ctx.projectHint).toBe("GpasPlus - Automatisation");
    expect(ctx.participants).toEqual([
      { name: "Marie Testard", email: "marie@fictiva.fr" },
      { name: "Éric", email: null },
    ]);
    expect(ctx.occurredAt?.toISOString()).toBe("2026-03-12T12:00:00.000Z");
    expect(ctx.body).toBe("Marie : on valide le devis.\nÉric : je relance lundi.");
  });

  it("ne prend pas une réplique du transcript pour une directive", () => {
    const body = ["Marie : on valide le devis.", "Projet : celui dont on parlait"].join("\n");
    const ctx = parseEmailContext(null, body, TODAY);
    expect(ctx.projectHint).toBeNull();
    expect(ctx.body).toBe(body);
  });

  it("le corps l'emporte sur l'objet", () => {
    const ctx = parseEmailContext(
      "Point [projet: Ancien]",
      "Projet : Nouveau\n\nMarie : bonjour.",
      TODAY,
    );
    expect(ctx.projectHint).toBe("Nouveau");
    expect(ctx.subject).toBe("Point");
    expect(ctx.body).toBe("Marie : bonjour.");
  });

  it("retire les parenthèses du nom d'un participant", () => {
    const ctx = parseEmailContext(null, "Avec : Marie Testard (Fictiva)\n\nMarie : ok.", TODAY);
    expect(ctx.participants).toEqual([{ name: "Marie Testard", email: null }]);
  });

  it("accepte un titre explicite", () => {
    const ctx = parseEmailContext(
      "Fwd: notes.txt",
      "Titre : Cadrage Fictiva\n\nMarie : ok.",
      TODAY,
    );
    expect(ctx.title).toBe("Cadrage Fictiva");
  });

  it("laisse le corps intact quand il ne commence par aucune directive", () => {
    const body = "Bonjour,\n\nvoici le compte-rendu.\n\nMarie : on valide.";
    expect(parseEmailContext(null, body, TODAY).body).toBe(body);
  });
});
