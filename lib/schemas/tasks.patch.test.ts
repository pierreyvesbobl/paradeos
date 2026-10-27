import { describe, expect, it } from "vitest";
import { createTaskSchema, patchTaskSchema } from "./tasks";

const id = "9cca5d5c-5039-47f6-9068-70368e6345e0";

describe("patchTaskSchema", () => {
  it("un patch sans assignés ne touche pas aux assignés", () => {
    // Régression Zod 4 : `.default([]).optional()` renvoyait `[]` pour une
    // clé absente, et chaque édition inline vidait task_assignees.
    const parsed = patchTaskSchema.parse({ id, priority: "high" });
    expect(parsed.assignees).toBeUndefined();
    expect(parsed.assigneeId).toBeUndefined();
  });

  it("une liste explicite est conservée, vide comprise", () => {
    expect(patchTaskSchema.parse({ id, assignees: [] }).assignees).toEqual([]);
    expect(patchTaskSchema.parse({ id, assignees: [{ kind: "user", id }] }).assignees).toHaveLength(
      1,
    );
  });

  it("la création garde une liste vide par défaut", () => {
    expect(createTaskSchema.parse({ title: "x" }).assignees).toEqual([]);
  });
});
