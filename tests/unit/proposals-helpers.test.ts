import {
  augmentTaskPayload,
  findByName,
  formatDueDate,
  groupByKind,
  isEditableKind,
  matchedSubtitle,
  matchedViewHref,
  normalizeName,
  orderProposals,
  readAssignees,
  summaryFor,
} from "@/components/proposals/helpers";
import type { Proposal, ProposalKind, ProposalStatus } from "@/components/proposals/types";
import { describe, expect, it } from "vitest";

function proposal(
  kind: ProposalKind,
  overrides: Partial<Proposal> & { payload?: Record<string, unknown> } = {},
): Proposal {
  return {
    id: overrides.id ?? `${kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    payload: overrides.payload ?? {},
    matchedId: overrides.matchedId ?? null,
    matchConfidence: overrides.matchConfidence ?? null,
    status: overrides.status ?? "pending",
    decidedBy: null,
    decidedAt: null,
    matchedProjectName: overrides.matchedProjectName ?? null,
    matchedContactName: overrides.matchedContactName ?? null,
    matchedEntityName: overrides.matchedEntityName ?? null,
  };
}

describe("isEditableKind", () => {
  it("accepte les kinds avec un éditeur", () => {
    for (const k of ["task", "project", "opportunity", "contact", "entity"] as const) {
      expect(isEditableKind(k)).toBe(true);
    }
  });

  it("refuse les rattachements et le brouillon de réponse", () => {
    for (const k of [
      "project_link",
      "entity_link",
      "project_contact_link",
      "draft_reply",
    ] as const) {
      expect(isEditableKind(k)).toBe(false);
    }
  });
});

describe("groupByKind", () => {
  it("regroupe par kind en conservant l'ordre d'insertion", () => {
    const a = proposal("task", { id: "a" });
    const b = proposal("contact", { id: "b" });
    const c = proposal("task", { id: "c" });
    const grouped = groupByKind([a, b, c]);
    expect(grouped.task?.map((p) => p.id)).toEqual(["a", "c"]);
    expect(grouped.contact?.map((p) => p.id)).toEqual(["b"]);
    expect(grouped.entity).toBeUndefined();
  });
});

describe("orderProposals", () => {
  it("suit l'ordre des kinds puis le statut, et ignore les kinds absents", () => {
    const items = [
      proposal("contact", { id: "contact-pending" }),
      proposal("task", { id: "task-rejected", status: "rejected" }),
      proposal("task", { id: "task-pending" }),
      proposal("draft_reply", { id: "draft" }),
      proposal("task", { id: "task-accepted", status: "accepted" }),
    ];
    const ordered = orderProposals(items, ["task", "contact"]);
    expect(ordered.map((p) => p.id)).toEqual([
      "task-pending",
      "contact-pending",
      "task-accepted",
      "task-rejected",
    ]);
  });

  it("est stable pour un même statut", () => {
    const statuses: ProposalStatus[] = ["pending", "pending", "pending"];
    const items = statuses.map((status, i) => proposal("task", { id: `t${i}`, status }));
    expect(orderProposals(items, ["task"]).map((p) => p.id)).toEqual(["t0", "t1", "t2"]);
  });
});

describe("formatDueDate", () => {
  it("formate une date ISO courte en français", () => {
    expect(formatDueDate("2026-03-05")).toMatch(/05 mars 2026/);
  });

  it("rend la chaîne brute si elle n'est pas une date", () => {
    expect(formatDueDate("bientôt")).toBe("bientôt");
  });
});

describe("summaryFor", () => {
  it("utilise le titre pour task et opportunity", () => {
    expect(summaryFor(proposal("task"), { title: "Relancer" })).toBe("Relancer");
    expect(summaryFor(proposal("opportunity"), { title: "Refonte" })).toBe("Refonte");
    expect(summaryFor(proposal("task"), {})).toBe("Sans titre");
  });

  it("utilise le nom pour project et entity", () => {
    expect(summaryFor(proposal("project"), { name: "Site" })).toBe("Site");
    expect(summaryFor(proposal("entity"), {})).toBe("Sans nom");
  });

  it("compose le nom d'un contact", () => {
    expect(summaryFor(proposal("contact"), { firstName: "Ada", lastName: "Lovelace" })).toBe(
      "Ada Lovelace",
    );
  });

  it("préfère le nom suggéré puis le nom matché pour project_link", () => {
    expect(
      summaryFor(proposal("project_link", { matchedProjectName: "Matché" }), {
        suggestedProjectName: "Suggéré",
      }),
    ).toBe("Suggéré");
    expect(summaryFor(proposal("project_link", { matchedProjectName: "Matché" }), {})).toBe(
      "Matché",
    );
    expect(summaryFor(proposal("project_link"), {})).toBe("Projet");
  });

  it("retombe sur le sujet pour draft_reply", () => {
    expect(summaryFor(proposal("draft_reply"), { subject: "Re: devis" })).toBe("Re: devis");
  });
});

describe("matchedSubtitle", () => {
  it("compose poste et entité pour un contact", () => {
    expect(matchedSubtitle(proposal("contact"), { jobTitle: "CTO", entityName: "Acme" })).toBe(
      "CTO · Acme",
    );
    expect(matchedSubtitle(proposal("contact"), {})).toBe("contact existant");
  });

  it("montre le type d'entité quand il est connu", () => {
    expect(matchedSubtitle(proposal("entity"), { kind: "prospect" })).toBe("prospect");
    expect(matchedSubtitle(proposal("entity"), {})).toBe("entité existante");
  });

  it("a un libellé fixe pour les autres kinds", () => {
    expect(matchedSubtitle(proposal("task"), {})).toBe("tâche existante");
    expect(matchedSubtitle(proposal("project_link"), {})).toBe("projet existant");
    expect(matchedSubtitle(proposal("opportunity"), {})).toBe("opportunité existante");
  });
});

describe("matchedViewHref", () => {
  it("renvoie null sans matchedId", () => {
    expect(matchedViewHref(proposal("task"))).toBeNull();
  });

  it("pointe vers la fiche selon le kind", () => {
    expect(matchedViewHref(proposal("task", { matchedId: "t1" }))).toBe("/taches/t1");
    expect(matchedViewHref(proposal("project", { matchedId: "p1" }))).toBe("/projets/p1");
    expect(matchedViewHref(proposal("project_link", { matchedId: "p2" }))).toBe("/projets/p2");
    expect(matchedViewHref(proposal("opportunity", { matchedId: "o1" }))).toBe("/projets/o1");
    expect(matchedViewHref(proposal("contact", { matchedId: "c1" }))).toBe("/contacts/c1");
    expect(matchedViewHref(proposal("entity", { matchedId: "e1" }))).toBe("/entites/e1");
  });

  it("n'a pas de fiche pour les rattachements sans page", () => {
    expect(matchedViewHref(proposal("entity_link", { matchedId: "x" }))).toBeNull();
    expect(matchedViewHref(proposal("project_contact_link", { matchedId: "x" }))).toBeNull();
  });
});

describe("readAssignees", () => {
  it("lit le format multi", () => {
    expect(
      readAssignees({
        assignees: [{ kind: "user", id: "u1" }, { kind: "contact", id: "c1" }, null, { id: 3 }],
      }),
    ).toEqual([
      { kind: "user", id: "u1" },
      { kind: "contact", id: "c1" },
    ]);
  });

  it("retombe sur les champs mono legacy", () => {
    expect(readAssignees({ assigneeId: "u1" })).toEqual([{ kind: "user", id: "u1" }]);
    expect(readAssignees({ assigneeContactId: "c1" })).toEqual([{ kind: "contact", id: "c1" }]);
    expect(readAssignees({})).toEqual([]);
  });
});

describe("normalizeName / findByName", () => {
  it("ignore casse, accents et ponctuation", () => {
    expect(normalizeName("  Bénilde-Liotard ")).toBe("benilde liotard");
  });

  it("préfère le match exact puis l'inclusion", () => {
    const list = [
      { id: "1", name: "Bénilde Liotard" },
      { id: "2", name: "Bénilde" },
    ];
    expect(findByName(list, "benilde", (x) => x.name)?.id).toBe("2");
    expect(findByName(list, "Liotard", (x) => x.name)?.id).toBe("1");
    expect(findByName(list, "", (x) => x.name)).toBeNull();
    expect(findByName(list, "Inconnu", (x) => x.name)).toBeNull();
  });
});

describe("augmentTaskPayload", () => {
  const projects = [{ id: "p1", name: "Refonte site" }];
  const users = [{ id: "u1", fullName: "Pierre-Yves Sage" }];
  const contacts = [{ id: "c1", fullName: "Ada Lovelace" }];

  it("résout l'assigné interne et le projet par nom", () => {
    const out = augmentTaskPayload(
      { assigneeName: "Pierre-Yves", assigneeKind: "internal", projectName: "refonte site" },
      projects,
      users,
      contacts,
    );
    expect(out.assigneeId).toBe("u1");
    expect(out.projectId).toBe("p1");
  });

  it("résout un externe dans les contacts", () => {
    const out = augmentTaskPayload(
      { assigneeName: "Ada", assigneeKind: "external" },
      projects,
      users,
      contacts,
    );
    expect(out.assigneeContactId).toBe("c1");
    expect(out.assigneeId).toBeUndefined();
  });

  it("essaie les users puis les contacts quand le kind est inconnu", () => {
    const out = augmentTaskPayload({ assigneeName: "Lovelace" }, projects, users, contacts);
    expect(out.assigneeContactId).toBe("c1");
  });

  it("ne touche pas aux ids déjà présents", () => {
    const out = augmentTaskPayload(
      { assigneeId: "keep", assigneeName: "Ada", projectId: "keep", projectName: "Refonte site" },
      projects,
      users,
      contacts,
    );
    expect(out.assigneeId).toBe("keep");
    expect(out.projectId).toBe("keep");
  });
});
