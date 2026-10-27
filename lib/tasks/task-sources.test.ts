import { describe, expect, it } from "vitest";
import {
  excerptFingerprint,
  excerptsFromPayload,
  MAX_EXCERPTS_PER_TASK,
  normalizeExcerpts,
  resolveMentionedTasks,
} from "./task-sources";

const vocab = [
  { id: "a", ref: "T1", title: "Écart Amazon", projectId: null, projectName: null, status: "todo" },
  { id: "b", ref: "T2", title: "Flux offres", projectId: null, projectName: null, status: "todo" },
];

describe("excerptFingerprint", () => {
  it("ignore la casse, les accents, la ponctuation et les blancs", () => {
    const a = excerptFingerprint("L'API ne remonte pas l'état critique, Amazon.");
    const b = excerptFingerprint("l api ne remonte pas   l etat critique amazon");
    expect(a).toBe(b);
  });
  it("distingue deux passages différents", () => {
    expect(excerptFingerprint("Amazon")).not.toBe(excerptFingerprint("Boulanger"));
  });
});

describe("normalizeExcerpts", () => {
  it("écarte les vides, dédoublonne et borne le nombre", () => {
    const raw = [
      { quote: "  ", speaker: "Vittorio" },
      { quote: "Il faut une alerte.", speaker: " Vittorio " },
      { quote: "il faut une alerte", speaker: null },
      ...Array.from({ length: 20 }, (_, i) => ({ quote: `Passage ${i}`, speaker: null })),
    ];
    const out = normalizeExcerpts(raw);
    expect(out[0]).toEqual({ quote: "Il faut une alerte.", speaker: "Vittorio" });
    expect(out).toHaveLength(MAX_EXCERPTS_PER_TASK);
  });
  it("accepte null", () => {
    expect(normalizeExcerpts(null)).toEqual([]);
  });
});

describe("resolveMentionedTasks", () => {
  it("résout les références, fusionne les doublons et ignore l'inconnu", () => {
    const out = resolveMentionedTasks(
      [
        {
          taskRef: "[T1]",
          excerpts: [{ quote: "Amazon remonte vert alors que c'est rouge.", speaker: "Vittorio" }],
        },
        { taskRef: "t1", excerpts: [{ quote: "On regarde l'API Seller Central.", speaker: null }] },
        { taskRef: "T9", excerpts: [{ quote: "Rien", speaker: null }] },
        { taskRef: "T2", excerpts: [] },
      ],
      vocab,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.taskId).toBe("a");
    expect(out[0]?.excerpts.map((e) => e.quote)).toEqual([
      "Amazon remonte vert alors que c'est rouge.",
      "On regarde l'API Seller Central.",
    ]);
  });
});

describe("excerptsFromPayload", () => {
  it("lit un payload ancien sans excerpts", () => {
    expect(excerptsFromPayload({ title: "x" })).toEqual([]);
  });
  it("tolère des éléments mal formés", () => {
    expect(excerptsFromPayload({ excerpts: [null, { quote: "ok" }, { speaker: "x" }] })).toEqual([
      { quote: "ok", speaker: null },
    ]);
  });
});
