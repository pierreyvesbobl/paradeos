import { describe, expect, it } from "vitest";
import { isReplyTask } from "./reply-tasks";

describe("isReplyTask", () => {
  it("reconnaît une tâche qui consiste à répondre", () => {
    expect(
      isReplyTask(
        "Répondre à Frédéric pour indiquer si l'on souhaite être mis en relation avec le cabinet Auditex",
      ),
    ).toBe(true);
    expect(isReplyTask("Relancer Marco sur le devis")).toBe(true);
    expect(isReplyTask("Confirmer à Bénédicte la date du point")).toBe(true);
    expect(isReplyTask("Donner son avis à Vittorio sur la v1")).toBe(true);
    expect(isReplyTask("Reply to Thomas about the demo")).toBe(true);
  });

  it("laisse passer les tâches qui demandent autre chose qu'une réponse", () => {
    expect(
      isReplyTask("Faire la demande d'agrément CII pour Automato et tenir Frédéric informé"),
    ).toBe(false);
    expect(isReplyTask("Ajouter un filtre par marketplace dans le matching EAN")).toBe(false);
    expect(isReplyTask("Préparer le dossier pour pouvoir répondre à l'appel d'offres")).toBe(false);
    expect(isReplyTask(null)).toBe(false);
  });
});
