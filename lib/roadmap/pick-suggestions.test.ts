import { describe, expect, it } from "vitest";
import { pickSuggestions } from "./pick-suggestions";

describe("pickSuggestions", () => {
  const known = { taskIds: new Set(["t1", "t2"]), itemIds: new Set(["1.1", "1.6"]) };

  it("écarte les ids inconnus et la confiance insuffisante", () => {
    const out = pickSuggestions(
      {
        pairs: [
          { taskId: "t1", itemId: "1.1", confidence: 0.95, reason: "même demande" },
          { taskId: "t2", itemId: "9.9", confidence: 0.9, reason: "item inventé" },
          { taskId: "tx", itemId: "1.6", confidence: 0.9, reason: "tâche inventée" },
          { taskId: "t2", itemId: "1.6", confidence: 0.4, reason: "trop vague" },
        ],
      },
      known,
    );
    expect(out).toEqual([
      { taskId: "t1", itemId: "1.1", confidence: 0.95, reason: "même demande" },
    ]);
  });

  it("garde un seul item par tâche, le plus sûr, et borne la confiance", () => {
    const out = pickSuggestions(
      {
        pairs: [
          { taskId: "t1", itemId: "1.6", confidence: 0.7, reason: "proche" },
          { taskId: "t1", itemId: "1.1", confidence: 1.4, reason: "identique" },
        ],
      },
      known,
    );
    expect(out).toEqual([{ taskId: "t1", itemId: "1.1", confidence: 1, reason: "identique" }]);
  });
});
