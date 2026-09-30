import { describe, expect, it } from "vitest";

import { payloadKey, proposalDedupeKey } from "@/lib/crm/proposal-keys";

describe("proposalDedupeKey", () => {
  it("rapproche deux écritures de la même société", () => {
    expect(proposalDedupeKey.entity("MKP Doctor")).toBe(proposalDedupeKey.entity("mkpdoctor"));
    expect(proposalDedupeKey.entity("Bobl SAS")).toBe(proposalDedupeKey.entity("Bobl"));
  });

  it("identifie un contact par son email avant son nom", () => {
    const withEmail = proposalDedupeKey.contact({
      firstName: "Julien",
      lastName: "Lacoëntre",
      email: "JULIEN@cephalopode.com",
    });
    expect(withEmail).toBe("julien@cephalopode.com");
  });

  it("retombe sur le nom quand l'email manque", () => {
    expect(proposalDedupeKey.contact({ firstName: "Vivien", lastName: "Garnes" })).toBe(
      proposalDedupeKey.contact({ firstName: "vivien", lastName: "garnes" }),
    );
  });

  it("scope la clé d'une tâche sur son projet", () => {
    expect(proposalDedupeKey.task("Relancer le devis", "p1")).not.toBe(
      proposalDedupeKey.task("Relancer le devis", "p2"),
    );
    expect(proposalDedupeKey.task("Relancer le devis", null)).toBe("relancerdevis:");
  });

  it("retourne une clé vide pour un nom illisible — rien à dédoublonner", () => {
    expect(proposalDedupeKey.entity("  ")).toBe("");
    expect(proposalDedupeKey.contact({ firstName: null, lastName: null })).toBe("");
  });
});

describe("payloadKey", () => {
  it("relit un payload stocké comme la clé d'origine", () => {
    expect(payloadKey("entity", { name: "mkpdoctor", kind: "other" })).toBe(
      proposalDedupeKey.entity("MKP Doctor"),
    );
    expect(payloadKey("contact", { firstName: "Guillaume", lastName: "Staub", email: null })).toBe(
      proposalDedupeKey.contact({ firstName: "Guillaume", lastName: "Staub" }),
    );
    expect(payloadKey("task", { title: "Envoyer la maquette", projectId: "p1" })).toBe(
      proposalDedupeKey.task("Envoyer la maquette", "p1"),
    );
  });

  it("tolère un payload vide ou mal typé", () => {
    expect(payloadKey("project", null)).toBe("");
    expect(payloadKey("entity", { name: 42 })).toBe("");
  });
});
