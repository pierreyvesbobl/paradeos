import { describe, expect, it } from "vitest";
import {
  flattenItems,
  parseRoadmap,
  roadmapStatusLabel,
  roadmapStatusTint,
  taskStatusForRoadmapStatus,
} from "./roadmap";

const sample = JSON.stringify({
  updated: "2026-10-28",
  statuses: { done: { label: "Livré" }, test: { label: "En test" } },
  epics: [
    {
      id: "E1",
      name: "Channel Health",
      goal: "Être prévenu",
      items: [
        { id: "1.1", prio: "P1", status: "done", title: "Alertes email", note: "Deux événements." },
        { id: "1.4", prio: "P1", status: "test", title: "Alerte flux" },
      ],
    },
    { id: "E4", name: "Pistes", items: [{ id: "4.a", status: "idea", title: "Annulations" }] },
  ],
  extra: "ignoré",
});

describe("parseRoadmap", () => {
  it("lit le format du dépôt et ignore les clés inconnues", () => {
    const r = parseRoadmap(sample);
    expect(r?.updated).toBe("2026-10-28");
    expect(r?.epics.map((e) => e.id)).toEqual(["E1", "E4"]);
    expect(flattenItems(r as NonNullable<typeof r>).map((i) => `${i.epicId}/${i.id}`)).toEqual([
      "E1/1.1",
      "E1/1.4",
      "E4/4.a",
    ]);
  });

  it("refuse un JSON cassé ou sans la forme attendue", () => {
    expect(parseRoadmap("{ pas du json")).toBeNull();
    expect(parseRoadmap(JSON.stringify({ epics: [{ name: "sans id" }] }))).toBeNull();
  });

  it("libellé du fichier, clé brute sinon", () => {
    const r = parseRoadmap(sample) as NonNullable<ReturnType<typeof parseRoadmap>>;
    expect(roadmapStatusLabel(r, "done")).toBe("Livré");
    expect(roadmapStatusLabel(r, "doing")).toBe("doing");
  });
});

describe("statuts", () => {
  it("livré clôt, en test et en attente mettent en attente client, idée ne change rien", () => {
    expect(taskStatusForRoadmapStatus("done")).toBe("done");
    expect(taskStatusForRoadmapStatus("test")).toBe("awaiting_client");
    expect(taskStatusForRoadmapStatus("wait")).toBe("awaiting_client");
    expect(taskStatusForRoadmapStatus("doing")).toBe("in_progress");
    expect(taskStatusForRoadmapStatus("todo")).toBe("todo");
    expect(taskStatusForRoadmapStatus("idea")).toBeNull();
    expect(taskStatusForRoadmapStatus("inconnu")).toBeNull();
  });

  it("teinte par défaut pour un statut inconnu", () => {
    expect(roadmapStatusTint("done")).toBe("green");
    expect(roadmapStatusTint("inconnu")).toBe("gray");
  });
});
