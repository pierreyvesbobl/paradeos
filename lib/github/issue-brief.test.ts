import { describe, expect, it } from "vitest";
import { buildIssueBrief, taskIdFromIssueBody } from "./issue-brief";

const taskId = "9cca5d5c-5039-47f6-9068-70368e6345e0";

describe("buildIssueBrief", () => {
  it("restitue les passages attribués, source par source, avec lien retour et marqueur", () => {
    const brief = buildIssueBrief({
      task: { id: taskId, title: "Contrôle de matching EAN", description: null, priority: "high" },
      project: { name: "GpasPlus" },
      sources: [
        {
          source: "meeting",
          label: "Point Tech GpasPlus",
          occurredAt: new Date("2026-10-20T12:00:00Z"),
          fromName: null,
          excerpts: [
            {
              quote: "tu peux prendre le dossier, c'est officiel",
              speaker: "Eric Alessandri",
              relation: "origin",
            },
          ],
        },
        {
          source: "email",
          label: "Re: EAN",
          occurredAt: new Date("2026-10-22T08:00:00Z"),
          fromName: "Vittorio Morino",
          excerpts: [
            {
              quote: "voici deux exemples de mauvais matching",
              speaker: null,
              relation: "mention",
            },
          ],
        },
      ],
      appUrl: "https://paradeos.vercel.app/",
    });
    expect(brief.title).toBe("Contrôle de matching EAN");
    expect(brief.body).toContain("Projet : **GpasPlus**");
    expect(brief.body).toContain(
      "https://paradeos.vercel.app/taches/9cca5d5c-5039-47f6-9068-70368e6345e0",
    );
    expect(brief.body).toContain("### Réunion du 20/10/2026 · Point Tech GpasPlus");
    expect(brief.body).toContain(
      "> tu peux prendre le dossier, c'est officiel\n> — Eric Alessandri _(à l'origine)_",
    );
    expect(brief.body).toContain("### Mail du 22/10/2026 de Vittorio Morino · Re: EAN");
    expect(brief.body).toContain("> — Vittorio Morino _(réévoquée)_");
    expect(taskIdFromIssueBody(brief.body)).toBe(taskId);
    expect(brief.fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it("change d'empreinte quand le titre ou un passage change", () => {
    const base = {
      task: { id: taskId, title: "A", description: null, priority: "medium" as const },
      project: null,
      sources: [],
      appUrl: "http://localhost:3000",
    };
    const a = buildIssueBrief(base).fingerprint;
    const b = buildIssueBrief({ ...base, task: { ...base.task, title: "B" } }).fingerprint;
    expect(a).not.toBe(b);
    expect(buildIssueBrief(base).body).toContain("Aucun passage verbatim");
  });
});
