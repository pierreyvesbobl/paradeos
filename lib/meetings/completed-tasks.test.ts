import { describe, expect, it } from "vitest";
import {
  assignTaskRefs,
  formatTaskVocabulary,
  normalizeTaskRef,
  resolveCompletedTasks,
} from "@/lib/meetings/completed-tasks";

const tasks = assignTaskRefs([
  { id: "a", title: "Envoyer le devis", projectId: "p1", projectName: "Site Bobl", status: "todo" },
  { id: "b", title: "Relancer Marc", projectId: null, projectName: null, status: "in_progress" },
  { id: "c", title: "Livrer la maquette", projectId: "p2", projectName: "App", status: "todo" },
]);

describe("assignTaskRefs", () => {
  it("numérote dans l'ordre reçu", () => {
    expect(tasks.map((t) => t.ref)).toEqual(["T1", "T2", "T3"]);
  });
});

describe("normalizeTaskRef", () => {
  it("accepte crochets, minuscules et zéros de tête", () => {
    expect(normalizeTaskRef("[T12]")).toBe("T12");
    expect(normalizeTaskRef(" t3 ")).toBe("T3");
    expect(normalizeTaskRef("T007")).toBe("T7");
  });

  it("renvoie une chaîne vide pour un titre ou n'importe quoi", () => {
    expect(normalizeTaskRef("Envoyer le devis")).toBe("");
    expect(normalizeTaskRef("")).toBe("");
  });
});

describe("resolveCompletedTasks", () => {
  it("retrouve la tâche derrière sa référence", () => {
    const out = resolveCompletedTasks(
      [{ taskRef: "[T1]", evidence: "j'ai envoyé le devis hier", confidence: "certain" }],
      tasks,
    );
    expect(out).toEqual([
      {
        taskId: "a",
        taskTitle: "Envoyer le devis",
        projectId: "p1",
        projectName: "Site Bobl",
        evidence: "j'ai envoyé le devis hier",
        confidence: "certain",
      },
    ]);
  });

  it("ignore les références inconnues", () => {
    expect(
      resolveCompletedTasks([{ taskRef: "T9", evidence: "x", confidence: "certain" }], tasks),
    ).toEqual([]);
  });

  it("fusionne les doublons en gardant la confiance la plus forte", () => {
    const out = resolveCompletedTasks(
      [
        { taskRef: "T2", evidence: "on a dû l'appeler", confidence: "probable" },
        { taskRef: "t2", evidence: "je l'ai relancé ce matin", confidence: "certain" },
        { taskRef: "T2", evidence: "encore", confidence: "probable" },
      ],
      tasks,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe("certain");
    expect(out[0]?.evidence).toBe("je l'ai relancé ce matin");
  });
});

describe("formatTaskVocabulary", () => {
  it("met les tâches du projet concerné en tête, dans leur propre liste", () => {
    const text = formatTaskVocabulary(tasks, "p2");
    expect(text.indexOf("[T3] Livrer la maquette")).toBeLessThan(
      text.indexOf("[T1] Envoyer le devis"),
    );
    expect(text).toContain("Tâches ouvertes du projet concerné");
    expect(text).toContain("Autres tâches ouvertes");
  });

  it("ne fait qu'une liste sans projet prioritaire", () => {
    const text = formatTaskVocabulary(tasks, null);
    expect(text).not.toContain("projet concerné");
    expect(text).toContain("- [T2] Relancer Marc [in_progress]");
  });

  it("ne renvoie rien sans tâche", () => {
    expect(formatTaskVocabulary([], "p1")).toBe("");
  });
});
