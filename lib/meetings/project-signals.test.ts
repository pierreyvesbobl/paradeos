import { describe, expect, it } from "vitest";
import {
  decideMeetingProject,
  participantSignals,
  taskSignals,
  titleSignals,
} from "./project-signals";

const gpas = {
  id: "gpas",
  name: "GpasPlus - Automatisation des processus e-commerce",
  entityId: "e-gpas",
  entityName: "GpasPlus",
};
const geek = {
  id: "geek",
  name: "The Geek Family - Partenariat IA",
  entityId: "e-geek",
  entityName: "The Geek Family",
};
const rcf1 = {
  id: "rcf1",
  name: "RCF - Pilote vidéo saints du jour",
  entityId: "e-rcf",
  entityName: "RCF",
};
const rcf2 = {
  id: "rcf2",
  name: "RCF Notre Dame - Contenu réseaux sociaux",
  entityId: "e-rcf",
  entityName: "RCF",
};
const parade = {
  id: "parade",
  name: "Mise en place de Parade OS",
  entityId: null,
  entityName: null,
};

describe("titleSignals", () => {
  it("le nom du client seul pèse, plus s'il n'a qu'un projet, réparti sinon", () => {
    expect(titleSignals("Point Channel Health GpasPlus", [gpas, geek])).toEqual([
      { projectId: "gpas", kind: "title_entity", weight: 0.6 },
    ]);
    const rcf = titleSignals("Point RCF", [rcf1, rcf2]);
    expect(rcf.map((s) => s.weight)).toEqual([0.25, 0.25]);
  });

  it("la partie propre au nom du projet pèse lourd", () => {
    const s = titleSignals("R1 The Geek Family – Partenariat IA", [geek]);
    expect(s.find((x) => x.kind === "title_project")?.projectId).toBe("geek");
  });

  it("rien pour un titre générique", () => {
    expect(titleSignals("[IMPORTANT] Point Parade", [gpas, geek])).toEqual([]);
    expect(titleSignals("23 oct. à 10:49", [gpas, geek, parade])).toEqual([]);
  });
});

describe("decideMeetingProject", () => {
  it("rattache quand le titre et les participants concordent", () => {
    const d = decideMeetingProject([
      ...titleSignals("Point Channel Health GpasPlus", [gpas, geek]),
      ...participantSignals([["gpas"], ["gpas"]]),
    ]);
    expect(d).toEqual({ projectId: "gpas", score: 1, reasons: ["title_entity", "participants"] });
  });

  it("rattache sur un indice fort seul", () => {
    expect(
      decideMeetingProject([{ projectId: "geek", kind: "named", weight: 0.8 }])?.projectId,
    ).toBe("geek");
  });

  it("ne rattache pas sur un indice faible seul", () => {
    expect(decideMeetingProject(taskSignals(["gpas", "gpas", "gpas"]))).toBeNull();
  });

  it("une réunion transverse reste sans projet", () => {
    expect(
      decideMeetingProject([
        { projectId: "gpas", kind: "named", weight: 0.8 },
        { projectId: "geek", kind: "named", weight: 0.8 },
      ]),
    ).toBeNull();
    expect(
      decideMeetingProject([
        ...taskSignals(["gpas", "gpas", "gpas", "geek"]),
        ...participantSignals([["gpas"]]),
        { projectId: "geek", kind: "title_entity", weight: 0.5 },
      ]),
    ).toBeNull();
  });
});

describe("taskSignals", () => {
  it("demande deux tâches et trois quarts sur le même projet", () => {
    expect(taskSignals(["gpas", null])).toEqual([]);
    expect(taskSignals(["gpas", "gpas", "geek"])).toEqual([]);
    expect(taskSignals(["gpas", "gpas", "gpas", "geek", null])).toEqual([
      { projectId: "gpas", kind: "tasks", weight: 0.5 },
    ]);
  });
});
