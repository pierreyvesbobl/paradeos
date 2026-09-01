import { describe, expect, it } from "vitest";
import {
  NAME_MATCH_FLOOR,
  scoreMatch,
  scoreMatchBest,
  similarityAmount,
  similarityName,
} from "./match";

/**
 * Le seuil de proposition côté reconciliation.ts. Reproduit ici pour que
 * les tests raisonnent en « est-ce que ce candidat serait affiché ».
 */
const PROPOSAL_THRESHOLD = 0.3;
const proposed = (s: { total: number }) => s.total >= PROPOSAL_THRESHOLD;

describe("plancher de nom", () => {
  it("n'invente plus un candidat sur le seul montant + date", () => {
    // Régression : une facture Dougs « Webedia » tombait sur le contrat
    // coworking de Yoann BUZENET parce que le montant (3000 €, un loyer
    // rond et récurrent) et la date coïncidaient. nom = 0 donnait
    // pourtant 0.5, au-dessus du seuil de 0.3.
    const s = scoreMatch(
      { legalName: "Webedia", amount: 3000, createdAt: "2026-03-01" },
      { clientName: "Contrat Yoann BUZENET", amount: 3000, date: "2026-03-01" },
    );
    expect(s.name).toBe(0);
    expect(s.rejectedOnName).toBe(true);
    expect(proposed(s)).toBe(false);
  });

  it("écarte deux coworkers différents au même loyer", () => {
    const s = scoreMatch(
      { legalName: "Arthur Heynard", amount: 750, createdAt: "2026-02-01" },
      { clientName: "Contrat Toon", amount: 750, date: "2026-02-01" },
    );
    expect(proposed(s)).toBe(false);
  });

  it("garde le montant et la date dans le détail pour le debug", () => {
    const s = scoreMatch(
      { legalName: "Webedia", amount: 3000, createdAt: "2026-03-01" },
      { clientName: "Contrat Yoann BUZENET", amount: 3000, date: "2026-03-01" },
    );
    expect(s.amount).toBe(1);
    expect(s.date).toBe(1);
  });

  it("laisse passer un vrai match", () => {
    const s = scoreMatch(
      { legalName: "Webedia", amount: 3000, createdAt: "2026-03-01" },
      { clientName: "Contrat Webedia", amount: 3000, date: "2026-03-01" },
    );
    expect(s.rejectedOnName).toBeUndefined();
    expect(s.total).toBeGreaterThan(0.9);
  });

  it("laisse passer un match au nom correct mais au montant faux", () => {
    // Un acompte partiel : le nom porte l'identité, le montant ne suit
    // pas. Doit rester proposable pour que l'utilisateur tranche.
    const s = scoreMatch(
      { legalName: "Webedia", amount: 1200, createdAt: "2026-03-01" },
      { clientName: "Webedia", amount: 3000, date: "2026-03-01" },
    );
    expect(s.amount).toBe(0);
    expect(proposed(s)).toBe(true);
  });

  it("respecte exactement le plancher documenté", () => {
    // « Cabinet Dupont » vs « Dupont Conseil » = 1 token commun / 3 = 0.33
    const weak = similarityName("Cabinet Dupont", "Dupont Conseil");
    expect(weak).toBeLessThan(NAME_MATCH_FLOOR);
    expect(
      proposed(
        scoreMatch(
          { legalName: "Cabinet Dupont", amount: 100 },
          { clientName: "Dupont Conseil", amount: 100 },
        ),
      ),
    ).toBe(false);
  });
});

describe("identité du client Dougs", () => {
  it("reconstruit le nom depuis firstName/lastName quand legalName manque", () => {
    const s = scoreMatch(
      { legalName: null, firstName: "Arthur", lastName: "Heynard", amount: 750 },
      { clientName: "Arthur Heynard", amount: 750 },
    );
    expect(s.name).toBe(1);
  });

  it("ne fabrique pas un nom « Arthur null » quand le nom de famille manque", () => {
    const s = scoreMatch(
      { legalName: null, firstName: "Arthur", lastName: null, amount: 750 },
      { clientName: "Arthur", amount: 750 },
    );
    expect(s.name).toBe(1);
  });

  it("sans aucun nom côté Dougs, aucun candidat n'est proposé", () => {
    const s = scoreMatch(
      { legalName: null, firstName: null, lastName: null, amount: 750, createdAt: "2026-02-01" },
      { clientName: "Contrat Toon", amount: 750, date: "2026-02-01" },
    );
    expect(proposed(s)).toBe(false);
  });
});

describe("scoreMatchBest", () => {
  const dougs = { legalName: "Boots & Cats SARL", amount: 600, createdAt: "2026-01-05" };

  it("retient la meilleure des identités possibles du contrat", () => {
    // Le contrat est connu sous 4 noms ; seul le 1er correspond.
    const s = scoreMatchBest(
      dougs,
      ["Boots & Cats SARL", "Boots & Cats", "Contrat Boots & Cats", "Yoann BUZENET"],
      { amount: 600, date: "2026-01-05" },
    );
    expect(s.name).toBe(1);
    expect(proposed(s)).toBe(true);
  });

  it("reste écarté si aucune des identités ne correspond", () => {
    const s = scoreMatchBest(dougs, ["Contrat Yoann BUZENET", "Arthur Heynard"], {
      amount: 600,
      date: "2026-01-05",
    });
    expect(proposed(s)).toBe(false);
  });

  it("gère une liste d'identités vide sans lever", () => {
    const s = scoreMatchBest(dougs, [], { amount: 600, date: "2026-01-05" });
    expect(proposed(s)).toBe(false);
  });

  it("ignore les identités nulles au milieu de la liste", () => {
    const s = scoreMatchBest(dougs, [null, undefined, "Boots & Cats SARL"], {
      amount: 600,
      date: "2026-01-05",
    });
    expect(s.name).toBe(1);
  });
});

describe("similarityAmount — pourquoi le montant ne suffit pas", () => {
  it("donne 1 à tous les loyers coworking identiques", () => {
    // Illustre la raison du plancher : ce signal ne distingue rien
    // entre deux contrats au même montant.
    expect(similarityAmount(750, 750)).toBe(1);
    expect(similarityAmount(3000, 3000)).toBe(1);
  });
});
