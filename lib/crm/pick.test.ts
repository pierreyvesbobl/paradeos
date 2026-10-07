import { describe, expect, it } from "vitest";

import {
  isGenericProjectName,
  MATCH_THRESHOLD,
  pickBestContact,
  pickBestMatch,
  pickBestProject,
} from "@/lib/crm/pick";

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

  describe("adresses secondaires", () => {
    const WITH_SECONDARY = [
      {
        id: "c1",
        firstName: "Julien",
        lastName: "Lacoëntre",
        email: "julien@cephalopode.com",
        emails: ["julien.perso@gmail.com"],
      },
    ];

    it("prime une adresse secondaire exacte comme une principale", () => {
      const m = pickBestContact(WITH_SECONDARY, {
        firstName: "J.",
        lastName: "L.",
        email: "Julien.Perso@gmail.com",
      });
      expect(m).toEqual({ id: "c1", name: "Julien Lacoëntre", confidence: 1 });
    });

    it("un nom identique n'est plus contredit si l'email est une secondaire", () => {
      const m = pickBestContact(WITH_SECONDARY, {
        firstName: "Julien",
        lastName: "Lacoentre",
        email: "julien.perso@gmail.com",
      });
      expect(m?.confidence).toBe(1);
    });

    it("reconnaît la partie locale d'une adresse secondaire", () => {
      const m = pickBestContact(WITH_SECONDARY, {
        firstName: "J.",
        lastName: "L.",
        email: "julien.perso@outlook.fr",
      });
      expect(m?.confidence).toBe(0.95);
    });
  });
});

describe("pickBestProject — ré-mention vs nouveau projet", () => {
  /**
   * Les quinze paires relevées dans la base le 2026-10-01, étiquetées à la
   * main. Elles sont ici pour une raison précise : le seuil dépend de la
   * séparation réelle entre les deux familles (0.38 d'un côté, 0.36 de
   * l'autre). Quiconque le déplace doit voir lesquelles il casse.
   */
  const PAIRS: Array<{ prop: string; exist: string; entity: string | null; same: boolean }> = [
    // Même projet, écrit autrement.
    {
      prop: "PrevandCare - Refonte du site",
      exist: "PrevandCare — PrevandCare - Refonte du site",
      entity: "PrevandCare",
      same: true,
    },
    {
      prop: "APKI - Refonte charte + Landing",
      exist: "Flow Boreal - APKI - Refonte charte + Landing",
      entity: "Flow Boreal",
      same: true,
    },
    {
      prop: "Avenir Focus - Ecolab",
      exist: "Avenir Focus - Echolab",
      entity: "Avenir Focus",
      same: true,
    },
    {
      prop: "Automatisation devis et facturation ETC",
      exist: "Automatisation process - ETC",
      entity: "Energy Technologie Conseil (E.T.C)",
      same: true,
    },
    {
      prop: "Automatisation des processus commerciaux et administratifs - ETC",
      exist: "Automatisation process - ETC",
      entity: "Energy Technologie Conseil (E.T.C)",
      same: true,
    },
    {
      prop: "ETC - Automatisation des processus Excel (devis, commandes, factures)",
      exist: "Automatisation process - ETC",
      entity: "Energy Technologie Conseil (E.T.C)",
      same: true,
    },
    {
      prop: "GpasPlus - Contrôle présence catalogue et suivi prix",
      exist: "GpasPlus - Contrôle de présence en ligne et suivi des prix",
      entity: "GpasPlus",
      same: true,
    },
    // Projets réellement distincts du même client.
    {
      prop: "Avenir Focus - Mirror Lab",
      exist: "Avenir Focus - Echolab",
      entity: "Avenir Focus",
      same: false,
    },
    {
      prop: "GpasPlus - Alerting marketplace",
      exist: "GpasPlus - Automatisation des processus e-commerce",
      entity: "GpasPlus",
      same: false,
    },
    {
      prop: "GpasPlus - Contrôle présence catalogue et suivi prix",
      exist: "GpasPlus - Automatisation des processus e-commerce",
      entity: "GpasPlus",
      same: false,
    },
    { prop: "Pilotes TV clips IA", exist: "Zapping IA", entity: "Parade", same: false },
    { prop: "Chaîne YouTube IA", exist: "Zapping IA", entity: "Parade", same: false },
    { prop: "Galak", exist: "Pilotes TV clips IA", entity: "Parade", same: false },
    {
      prop: "Maestro - Formation",
      exist: "Maestro/Lion - Maria School - Formations",
      entity: "Maestro",
      same: false,
    },
    {
      prop: "Espace Scène - Gestion de réservations et flux vidéo",
      exist: "Espace Rhône - Réservation de salles connectée",
      entity: null,
      same: false,
    },
  ];

  const match = (pair: (typeof PAIRS)[number]) =>
    pickBestProject([{ id: "x", name: pair.exist }], pair.prop, pair.entity);

  /**
   * Les deux verdicts ne coûtent pas la même chose, et c'est tout l'enjeu :
   *
   *  - **confiance 1** supprime la proposition. Une erreur ici est
   *     invisible : le projet manquant ne sera jamais créé, personne ne
   *     saura qu'il a été écarté. Zéro erreur tolérée.
   *  - **candidat** garde la proposition et y accroche le projet existant,
   *     donc /inbox l'affiche en « déjà en base ». Une erreur ici coûte un
   *     regard : on accepte quand même en un clic.
   *
   * Les assertions suivent cette asymétrie.
   */
  it("ne déclare jamais certain deux projets réellement distincts", () => {
    const faux = PAIRS.filter((p) => !p.same && match(p)?.confidence === 1).map(
      (p) => `« ${p.prop} » / « ${p.exist} »`,
    );
    expect(faux).toEqual([]);
  });

  it("signale au moins un candidat pour chaque vraie ré-mention", () => {
    const manques = PAIRS.filter((p) => p.same && match(p) === null).map(
      (p) => `« ${p.prop} » / « ${p.exist} »`,
    );
    expect(manques).toEqual([]);
  });

  it("ne signale qu'un candidat de trop parmi les projets distincts", () => {
    // « Maestro - Formation » et « Maestro/Lion - Maria School - Formations »
    // partagent « formation(s) » : le seul cas, sur les quinze, où le
    // candidat est signalé à tort. Il reste proposable en un clic, et
    // resserrer le seuil pour l'exclure (0.36 contre 0.38 pour le plus
    // faible des vrais doublons) ne tiendrait qu'à cet échantillon.
    const signales = PAIRS.filter((p) => !p.same && match(p) !== null).map((p) => p.prop);
    expect(signales).toEqual(["Maestro - Formation"]);
  });

  it("ne rapproche pas deux projets d'un client sur son seul nom", () => {
    // Avant le retrait du nom du client, ces deux-là scoraient 0.67 — autant
    // qu'un vrai doublon. C'est ce bruit qui poussait à créer des projets.
    expect(
      pickBestProject(
        [{ id: "echolab", name: "Avenir Focus - Echolab" }],
        "Avenir Focus - Mirror Lab",
        "Avenir Focus",
      ),
    ).toBeNull();
  });

  it("tient un nom plus court pour le même projet, pas pour un homonyme partiel", () => {
    // Deux mots distinctifs communs et inclus : c'est le même projet.
    expect(
      pickBestProject(
        [{ id: "p", name: "Flow Boreal - APKI - Refonte charte + Landing" }],
        "APKI - Refonte charte",
        "Flow Boreal",
      )?.confidence,
    ).toBe(1);
    // Un seul mot distinctif commun ne prouve rien : « Lab » n'est pas
    // « Mirror Lab ».
    expect(
      pickBestProject(
        [{ id: "p", name: "Avenir Focus - Mirror Lab" }],
        "Avenir Focus - Lab",
        "Avenir Focus",
      )?.confidence,
    ).not.toBe(1);
  });

  it("garde la confiance 1 pour une égalité de clé", () => {
    const match = pickBestProject(
      [{ id: "p", name: "GpasPlus — Automatisation" }],
      "gpasplus automatisation",
      "GpasPlus",
    );
    expect(match?.confidence).toBe(1);
  });
});

describe("isGenericProjectName", () => {
  it("reconnaît les noms de remplissage", () => {
    for (const name of [
      "Projet en cours",
      "Suivi de projet",
      "À définir",
      "Nouveau projet",
      "Projet",
      "Dossier client",
      "",
    ]) {
      expect(isGenericProjectName(name), name).toBe(true);
    }
  });

  it("laisse passer un nom qui dit quelque chose", () => {
    for (const name of [
      "Automatisation process - ETC",
      "Galak",
      "Suivi de la refonte Thermigo",
      "Projet Antia - EBP",
    ]) {
      expect(isGenericProjectName(name), name).toBe(false);
    }
  });
});

describe("isGenericProjectName — le client ne fait pas un nom", () => {
  it("voit le remplissage sous le nom du client", () => {
    // Sans retirer « Flow Boreal », ce nom passerait pour distinctif et
    // créerait une fiche « Flow Boreal - Projet en cours » que personne ne
    // retrouverait.
    expect(isGenericProjectName("Flow Boreal - Projet en cours", "Flow Boreal")).toBe(true);
    expect(isGenericProjectName("Automataux - Suivi de projet", "Automataux")).toBe(true);
    expect(isGenericProjectName("GpasPlus — à définir", "GpasPlus")).toBe(true);
  });

  it("laisse passer un projet nommé comme son client", () => {
    // « Galak » chez Parade : tout le nom est distinctif, rien à retirer.
    expect(isGenericProjectName("Thermigo", "Thermigo")).toBe(false);
    expect(isGenericProjectName("Flow Boreal - APKI", "Flow Boreal")).toBe(false);
  });
});
