import { describe, expect, it } from "vitest";
import {
  parseDriveTranscriptName,
  parseMeetingStamp,
  parsePeopleList,
  parseZoneOffsetMinutes,
} from "./drive-filename";

describe("parseMeetingStamp", () => {
  it("lit l'horodatage de Google Meet avec son fuseau", () => {
    expect(parseMeetingStamp("2026/07/03 10:28 CEST")?.toISOString()).toBe(
      "2026-07-03T08:28:00.000Z",
    );
    expect(parseMeetingStamp("2026/01/09 09:00 CET")?.toISOString()).toBe(
      "2026-01-09T08:00:00.000Z",
    );
    expect(parseMeetingStamp("2026/07/03 10:28 GMT+2")?.toISOString()).toBe(
      "2026-07-03T08:28:00.000Z",
    );
    expect(parseMeetingStamp("2026/07/03 10:28 UTC")?.toISOString()).toBe(
      "2026-07-03T10:28:00.000Z",
    );
  });

  it("retombe sur Europe/Paris quand aucun fuseau n'est écrit, heure d'été comprise", () => {
    // 3 juillet : UTC+2. 9 janvier : UTC+1. Le décalage suit la date, il
    // n'est pas figé.
    expect(parseMeetingStamp("2026/07/03 10:28")?.toISOString()).toBe("2026-07-03T08:28:00.000Z");
    expect(parseMeetingStamp("2026/01/09 10:28")?.toISOString()).toBe("2026-01-09T09:28:00.000Z");
  });

  it("accepte les autres écritures courantes", () => {
    expect(parseMeetingStamp("2026-07-03 10h28 CEST")?.toISOString()).toBe(
      "2026-07-03T08:28:00.000Z",
    );
    expect(parseMeetingStamp("03/07/2026 10:28 CEST")?.toISOString()).toBe(
      "2026-07-03T08:28:00.000Z",
    );
  });

  it("pose midi quand le nom ne porte pas d'heure", () => {
    expect(parseMeetingStamp("2026/07/03 CEST")?.toISOString()).toBe("2026-07-03T10:00:00.000Z");
  });

  it("refuse ce qui n'est pas un horodatage", () => {
    expect(parseMeetingStamp("Transcript")).toBeNull();
    expect(parseMeetingStamp("Badr Bouslikhin")).toBeNull();
    // Une date impossible n'est pas repliée sur le mois suivant.
    expect(parseMeetingStamp("2026/02/31 10:28 CEST")).toBeNull();
    // Un reste illisible : ce n'était pas un horodatage.
    expect(parseMeetingStamp("2026/07/03 10:28 chez Nextase")).toBeNull();
    // Numéro de version, pas une date.
    expect(parseMeetingStamp("1.2.3")).toBeNull();
  });
});

describe("parseZoneOffsetMinutes", () => {
  it("lit les abréviations sans ambiguïté et les décalages explicites", () => {
    expect(parseZoneOffsetMinutes("CEST")).toBe(120);
    expect(parseZoneOffsetMinutes("utc")).toBe(0);
    expect(parseZoneOffsetMinutes("GMT-05:30")).toBe(-330);
    expect(parseZoneOffsetMinutes("+0200")).toBe(120);
  });

  it("laisse tomber les abréviations qui désignent deux fuseaux", () => {
    // IST : Irlande, Israël, Inde. CST : Chicago ou Shanghai.
    expect(parseZoneOffsetMinutes("IST")).toBeNull();
    expect(parseZoneOffsetMinutes("CST")).toBeNull();
  });
});

describe("parsePeopleList", () => {
  it("reconnaît la liste de participants dont Meet nomme ses fichiers", () => {
    expect(parsePeopleList("Badr Bouslikhin et Pierre-Yves Sage")).toEqual([
      "Badr Bouslikhin",
      "Pierre-Yves Sage",
    ]);
    expect(parsePeopleList("Marie Testard, Éric Dubois & Jean Meyer")).toEqual([
      "Marie Testard",
      "Éric Dubois",
      "Jean Meyer",
    ]);
  });

  it("ne prend pas un sujet de réunion pour des personnes", () => {
    expect(parsePeopleList("Point hebdo GpasPlus")).toEqual([]);
    expect(parsePeopleList("Nextase")).toEqual([]);
    // Deux chunks, mais l'un nomme un genre de réunion.
    expect(parsePeopleList("Point Hebdo et Revue Budget")).toEqual([]);
    // Une seule personne : Meet n'écrit ça que pour un sujet.
    expect(parsePeopleList("Badr Bouslikhin")).toEqual([]);
  });
});

describe("parseDriveTranscriptName", () => {
  it("lit le nom que Google Meet donne à un tête-à-tête", () => {
    const parsed = parseDriveTranscriptName(
      "Badr Bouslikhin et Pierre-Yves Sage - 2026/07/03 10:28 CEST - Transcript",
    );
    expect(parsed.title).toBe("Badr Bouslikhin et Pierre-Yves Sage");
    expect(parsed.occurredAt?.toISOString()).toBe("2026-07-03T08:28:00.000Z");
    expect(parsed.participants).toEqual(["Badr Bouslikhin", "Pierre-Yves Sage"]);
    // Une liste de personnes n'est pas un nom de projet.
    expect(parsed.projectHint).toBeNull();
  });

  it("garde le sujet comme piste de projet quand le titre en est un", () => {
    const parsed = parseDriveTranscriptName(
      "GpasPlus - Automatisation - 2026/07/03 14:00 CEST - Notes de la réunion",
    );
    expect(parsed.title).toBe("GpasPlus - Automatisation");
    expect(parsed.projectHint).toBe("GpasPlus - Automatisation");
    expect(parsed.participants).toEqual([]);
    expect(parsed.occurredAt?.toISOString()).toBe("2026-07-03T12:00:00.000Z");
  });

  it("retire l'extension et le suffixe de copie Drive", () => {
    const parsed = parseDriveTranscriptName(
      "Point hebdo Nextase - 2026/07/03 09:00 CEST - Transcript (2).txt",
    );
    expect(parsed.title).toBe("Point hebdo Nextase");
    expect(parsed.occurredAt?.toISOString()).toBe("2026-07-03T07:00:00.000Z");
  });

  it("rend le nom tel quel quand il ne porte pas d'horodatage", () => {
    const parsed = parseDriveTranscriptName("Compte-rendu atelier IA.txt");
    expect(parsed.title).toBe("Compte-rendu atelier IA");
    expect(parsed.occurredAt).toBeNull();
    expect(parsed.projectHint).toBe("Compte-rendu atelier IA");
  });

  it("ne rend jamais un titre vide, même quand le nom n'est qu'un horodatage", () => {
    const parsed = parseDriveTranscriptName("2026/07/03 10:28 CEST - Transcript");
    expect(parsed.title.length).toBeGreaterThan(0);
    expect(parsed.occurredAt?.toISOString()).toBe("2026-07-03T08:28:00.000Z");
  });
});

describe("parseDriveTranscriptName — noms rencontrés en base", () => {
  it("écarte les mentions de l'outil qui a produit le fichier", () => {
    // Gemini nomme ses comptes-rendus autrement que Meet nomme ses
    // transcripts ; l'un comme l'autre est une queue à retirer.
    const gemini = parseDriveTranscriptName(
      "Projet Antia - EBP - AR Fournisseurs - 2026/05/07 09:58 CEST - Notes par Gemini",
    );
    expect(gemini.title).toBe("Projet Antia - EBP - AR Fournisseurs");
    expect(gemini.occurredAt?.toISOString()).toBe("2026-05-07T07:58:00.000Z");

    // Sans horodatage, la queue doit tomber quand même.
    expect(parseDriveTranscriptName("Sprint Parade - Notes par Gemini").title).toBe(
      "Sprint Parade",
    );
  });

  it("tolère les espaces doubles du nom déposé par Meet", () => {
    const parsed = parseDriveTranscriptName(
      "Eric Alessandri  et Pierre-Yves Sage - 2026/07/29 09:58 CEST - Transcript",
    );
    expect(parsed.participants).toEqual(["Eric Alessandri", "Pierre-Yves Sage"]);
    expect(parsed.occurredAt?.toISOString()).toBe("2026-07-29T07:58:00.000Z");
  });
});
