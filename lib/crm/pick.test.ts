import { describe, expect, it } from "vitest";

import { MATCH_THRESHOLD, pickBestContact, pickBestMatch } from "@/lib/crm/pick";

const ENTITIES = [
  { id: "e1", name: "MKP Doctor" },
  { id: "e2", name: "Aparisi Consulting" },
  { id: "e3", name: "CAD.42 SERVICES" },
  { id: "e4", name: "Bobl" },
];

describe("pickBestMatch", () => {
  it("lie un nom collé à son équivalent espacé (le doublon historique)", () => {
    const m = pickBestMatch(ENTITIES, "mkpdoctor", MATCH_THRESHOLD.entity);
    expect(m).toEqual({ id: "e1", name: "MKP Doctor", confidence: 1 });
  });

  it("ignore la forme juridique", () => {
    expect(pickBestMatch(ENTITIES, "Bobl SAS", MATCH_THRESHOLD.entity)?.id).toBe("e4");
  });

  it("rattrape une faute d'orthographe au-dessus du seuil", () => {
    const m = pickBestMatch(ENTITIES, "a paris consulting", MATCH_THRESHOLD.entity);
    expect(m?.id).toBe("e2");
    expect(m?.confidence).toBeGreaterThan(MATCH_THRESHOLD.entity);
    expect(m?.confidence).toBeLessThan(1);
  });

  it("ne matche pas deux sociétés différentes qui partagent un mot", () => {
    expect(pickBestMatch(ENTITIES, "QG Services nettoyage", MATCH_THRESHOLD.entity)).toBeNull();
  });

  it("retourne null sur un nom sans contenu", () => {
    expect(pickBestMatch(ENTITIES, "  ", MATCH_THRESHOLD.entity)).toBeNull();
  });

  it("garde le meilleur score quand plusieurs candidats passent le seuil", () => {
    const candidates = [
      { id: "p1", name: "Flow Boreal - Refonte charte" },
      { id: "p2", name: "Flow Boreal - Refonte charte + Landing" },
    ];
    expect(pickBestMatch(candidates, "Flow Boreal - Refonte charte", 0.5)?.id).toBe("p1");
  });
});

const CONTACTS = [
  { id: "c1", firstName: "Julien", lastName: "Lacoëntre", email: "julien@cephalopode.com" },
  { id: "c2", firstName: "Amine", lastName: "Slim", email: null },
  { id: "c3", firstName: "Raphaël", lastName: "Garcia-Brotons", email: null },
];

describe("pickBestContact", () => {
  it("prime l'email exact", () => {
    const m = pickBestContact(CONTACTS, {
      firstName: "J.",
      lastName: "L.",
      email: "JULIEN@cephalopode.com",
    });
    expect(m).toEqual({ id: "c1", name: "Julien Lacoëntre", confidence: 1 });
  });

  it("lie un nom identique aux accents près", () => {
    const m = pickBestContact(CONTACTS, { firstName: "Julien", lastName: "Lacoentre" });
    expect(m?.id).toBe("c1");
    expect(m?.confidence).toBe(1);
  });

  it("signale par la confiance un nom identique dont l'email contredit", () => {
    const m = pickBestContact(CONTACTS, {
      firstName: "Julien",
      lastName: "Lacoentre",
      email: "julien.lacoentre@nextase.fr",
    });
    expect(m?.id).toBe("c1");
    expect(m?.confidence).toBe(0.9);
  });

  it("reconnaît la même personne sur la partie locale de l'email", () => {
    const m = pickBestContact(
      [{ id: "c9", firstName: "Vivien", lastName: "Garnes", email: "vivien.garnes@old.fr" }],
      { firstName: "V.", lastName: "G.", email: "vivien.garnes+crm@new.com" },
    );
    expect(m).toEqual({ id: "c9", name: "Vivien Garnes", confidence: 0.95 });
  });

  it("matche sur un prénom seul quand le nom de famille manque", () => {
    const m = pickBestContact(CONTACTS, { firstName: "Amine", lastName: null });
    expect(m?.id).toBe("c2");
  });

  it("refuse de trancher entre deux homonymes sur un prénom seul", () => {
    const m = pickBestContact(
      [
        { id: "c7", firstName: "Amine", lastName: "Slim", email: null },
        { id: "c8", firstName: "Amine", lastName: "Bekkar", email: null },
      ],
      { firstName: "Amine", lastName: null },
    );
    expect(m).toBeNull();
  });

  it("retourne null quand ni nom ni email n'est exploitable", () => {
    expect(pickBestContact(CONTACTS, { firstName: "", lastName: null })).toBeNull();
  });

  it("ne confond pas deux personnes distinctes", () => {
    expect(pickBestContact(CONTACTS, { firstName: "Bastien", lastName: "Georges" })).toBeNull();
  });
});
