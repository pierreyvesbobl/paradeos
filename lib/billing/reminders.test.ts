import { describe, expect, it } from "vitest";
import { reminderLabel, reminderState } from "./reminders";

// Cadence des trois marques : [7, 21, 45] jours après l'échéance.
const base = {
  brand: "coworking" as const,
  dueDate: "2026-09-01",
  reminderCount: 0,
  lastRemindedAt: null,
  today: "2026-09-01",
};

describe("reminderState", () => {
  it("n'attend rien le jour de l'échéance", () => {
    const s = reminderState(base);
    expect(s.due).toBe(false);
    expect(s.stage).toBe(1);
    expect(s.dueOn).toBe("2026-09-08");
    expect(s.daysLate).toBe(-7);
  });

  it("déclenche la première relance 7 jours après l'échéance", () => {
    const s = reminderState({ ...base, today: "2026-09-08" });
    expect(s.due).toBe(true);
    expect(s.stage).toBe(1);
    expect(s.daysLate).toBe(0);
  });

  it("compte le retard sur la relance, pas sur l'échéance", () => {
    const s = reminderState({ ...base, today: "2026-09-15" });
    expect(s.daysLate).toBe(7);
  });

  it("passe au palier suivant quand une relance a été faite", () => {
    const s = reminderState({ ...base, reminderCount: 1, today: "2026-09-15" });
    expect(s.stage).toBe(2);
    expect(s.dueOn).toBe("2026-09-22");
    expect(s.due).toBe(false);
  });

  it("ne réclame pas deux fois la même relance le jour où elle vient d'être faite", () => {
    const s = reminderState({
      ...base,
      today: "2026-09-10",
      lastRemindedAt: "2026-09-10T14:32:00.000Z",
    });
    expect(s.daysLate).toBe(2);
    expect(s.due).toBe(false);
  });

  it("réclame à nouveau le lendemain si le palier est toujours dépassé", () => {
    const s = reminderState({
      ...base,
      today: "2026-09-11",
      lastRemindedAt: "2026-09-10T14:32:00.000Z",
    });
    expect(s.due).toBe(true);
  });

  it("ne réclame plus rien quand la cadence est épuisée", () => {
    const s = reminderState({ ...base, reminderCount: 3, today: "2026-12-01" });
    expect(s.exhausted).toBe(true);
    expect(s.due).toBe(false);
    expect(s.dueOn).toBeNull();
  });

  it("ne cadence rien sans échéance", () => {
    const s = reminderState({ ...base, dueDate: null, today: "2026-12-01" });
    expect(s.due).toBe(false);
    expect(s.dueOn).toBeNull();
    expect(s.daysLate).toBeNull();
  });

  it("traverse un changement de mois", () => {
    const s = reminderState({ ...base, dueDate: "2026-09-28" });
    expect(s.dueOn).toBe("2026-10-05");
  });
});

describe("reminderLabel", () => {
  it("annonce une relance due aujourd'hui", () => {
    expect(reminderLabel(reminderState({ ...base, today: "2026-09-08" }))).toBe(
      "Relance 1 attendue aujourd'hui",
    );
  });

  it("chiffre le retard", () => {
    expect(reminderLabel(reminderState({ ...base, today: "2026-09-15" }))).toBe(
      "Relance 1 en retard de 7 j",
    );
  });

  it("annonce une relance à venir", () => {
    expect(reminderLabel(reminderState(base))).toBe("Relance 1 dans 7 j");
  });

  it("le dit quand la cadence est épuisée", () => {
    expect(reminderLabel(reminderState({ ...base, reminderCount: 3 }))).toBe("Cadence épuisée");
  });

  it("ne dit rien sans échéance", () => {
    expect(reminderLabel(reminderState({ ...base, dueDate: null }))).toBeNull();
  });
});
