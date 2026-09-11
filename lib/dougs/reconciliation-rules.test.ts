import { describe, expect, it } from "vitest";
import {
  INVOICE_CANDIDATES_LIMIT,
  PROPOSAL_THRESHOLD,
  classifyLinkedInvoiceRows,
  dougsMatchAmount,
  dougsName,
  dougsSideOf,
  invoiceCandidateLabel,
  isDougsCreditNote,
  isMatchableInvoiceCandidate,
  negate,
  pMap,
  pickHt,
  pickTtc,
  projectReferenceAmount,
  rankCandidates,
  resolveCreditNoteLink,
  scoreExistingInvoiceCandidate,
  scoreNewProjectMilestoneCandidate,
  scoreQuoteProjectCandidates,
  sortByBestCandidate,
  sortByCreatedAtDesc,
} from "./reconciliation-rules";

// ---------------------------------------------------------------------
// Montants Dougs
// ---------------------------------------------------------------------

describe("pickHt / pickTtc / dougsMatchAmount", () => {
  it("préfère totalNetAmount à netAmount", () => {
    expect(pickHt({ totalNetAmount: 1200.5, netAmount: 999 })).toBe(1200.5);
    expect(pickHt({ netAmount: 999 })).toBe(999);
  });

  it("ignore un montant qui n'est pas un nombre (string, null)", () => {
    expect(pickHt({ netAmount: "1200" })).toBeNull();
    expect(pickHt({ totalNetAmount: null })).toBeNull();
    expect(pickTtc({ amount: "1440" })).toBeNull();
  });

  it("préfère totalAmountWithVat à amount", () => {
    expect(pickTtc({ totalAmountWithVat: 1440.6, amount: 1 })).toBe(1440.6);
  });

  it("le montant de matching est le HT, à défaut le TTC", () => {
    expect(dougsMatchAmount({ totalNetAmount: 1000, totalAmountWithVat: 1200 })).toBe(1000);
    expect(dougsMatchAmount({ totalAmountWithVat: 1200 })).toBe(1200);
    expect(dougsMatchAmount({})).toBeNull();
  });

  it("un HT à 0 n'est pas confondu avec un HT absent", () => {
    // `??` ne bascule sur le TTC que si le HT est null, pas s'il vaut 0.
    expect(dougsMatchAmount({ totalNetAmount: 0, totalAmountWithVat: 1200 })).toBe(0);
  });
});

describe("negate", () => {
  it("force un montant en négatif, quel que soit son signe d'origine", () => {
    expect(negate(120.5)).toBe(-120.5);
    expect(negate(-30)).toBe(-30);
  });

  it("garde 0 à 0 (pas de -0 à l'affichage) et null à null", () => {
    expect(Object.is(negate(0), 0)).toBe(true);
    expect(negate(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Avoirs
// ---------------------------------------------------------------------

describe("isDougsCreditNote", () => {
  it("détecte un avoir par isRefund même si le montant reste positif", () => {
    expect(
      isDougsCreditNote({ isRefund: true, totalNetAmount: 500, totalAmountWithVat: 600 }),
    ).toBe(true);
  });

  it("détecte un avoir par isRefund sans aucun montant", () => {
    expect(isDougsCreditNote({ isRefund: true })).toBe(true);
  });

  it("accepte un montant négatif comme signal de secours", () => {
    expect(isDougsCreditNote({ isRefund: false, totalNetAmount: -500 })).toBe(true);
    expect(isDougsCreditNote({ isRefund: null, totalAmountWithVat: -600 })).toBe(true);
  });

  it("une facture normale n'est pas un avoir", () => {
    expect(isDougsCreditNote({ isRefund: false, totalNetAmount: 500 })).toBe(false);
    expect(isDougsCreditNote({ totalNetAmount: 500, totalAmountWithVat: 600 })).toBe(false);
    expect(isDougsCreditNote({})).toBe(false);
  });

  it("un montant à 0 n'est pas un avoir", () => {
    expect(isDougsCreditNote({ totalNetAmount: 0 })).toBe(false);
  });
});

describe("resolveCreditNoteLink", () => {
  const dougsInvoice = {
    reference: "F-2026-0042",
    totalNetAmount: 3000,
    clientData: { legalName: "Webedia" },
  };

  it("renvoie null sans row credit_note ou sans facture annulée connue", () => {
    expect(resolveCreditNoteLink(undefined, null, null)).toBeNull();
    expect(
      resolveCreditNoteLink({ cancelsInvoiceId: "inv-1", cancelsDougsInvoiceId: null }, null, null),
    ).toBeNull();
  });

  it("préfère la facture Paradeos annulée (label + montant local)", () => {
    const link = resolveCreditNoteLink(
      { cancelsInvoiceId: "inv-1", cancelsDougsInvoiceId: "dougs-1" },
      { label: "Webedia — Acompte 40 %", amountHt: "3000.00", dougsReference: "F-2026-0042" },
      dougsInvoice,
    );
    expect(link).toEqual({
      cancelsDougsInvoiceId: "dougs-1",
      invoice: { reference: "F-2026-0042", clientName: "Webedia — Acompte 40 %", totalHt: 3000 },
    });
  });

  it("retombe sur la facture Dougs du run courant si le lien local a été cascadé", () => {
    const link = resolveCreditNoteLink(
      { cancelsInvoiceId: null, cancelsDougsInvoiceId: "dougs-1" },
      null,
      dougsInvoice,
    );
    expect(link?.invoice).toEqual({
      reference: "F-2026-0042",
      clientName: "Webedia",
      totalHt: 3000,
    });
  });

  it("garde l'id Dougs même si aucune facture n'est résolue", () => {
    const link = resolveCreditNoteLink(
      { cancelsInvoiceId: null, cancelsDougsInvoiceId: "dougs-1" },
      null,
      null,
    );
    expect(link).toEqual({ cancelsDougsInvoiceId: "dougs-1", invoice: null });
  });

  it("un montant local à 0 devient null (pas 0)", () => {
    const link = resolveCreditNoteLink(
      { cancelsInvoiceId: "inv-1", cancelsDougsInvoiceId: "dougs-1" },
      { label: "Avoir", amountHt: "0.00", dougsReference: null },
      null,
    );
    expect(link?.invoice?.totalHt).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Identité client
// ---------------------------------------------------------------------

describe("dougsName", () => {
  it("suit la priorité legalName > name > prénom nom > fallback", () => {
    expect(dougsName({ legalName: "Acme SAS", name: "Acme", firstName: "A" })).toBe("Acme SAS");
    expect(dougsName({ name: "Acme", firstName: "Alice", lastName: "Martin" })).toBe("Acme");
    expect(dougsName({ firstName: "Alice", lastName: "Martin" })).toBe("Alice Martin");
    expect(dougsName({ firstName: "Alice" })).toBe("Alice");
    expect(dougsName(null, "Nom du list endpoint")).toBe("Nom du list endpoint");
  });

  it("affiche un tiret quand rien n'est exploitable", () => {
    expect(dougsName(null)).toBe("—");
    expect(dougsName({ firstName: null, lastName: null }, "")).toBe("—");
    expect(dougsName({ legalName: "" })).toBe("—");
  });
});

describe("dougsSideOf", () => {
  it("assemble identité, montant HT et date depuis un payload Dougs", () => {
    expect(
      dougsSideOf({
        clientData: { legalName: "Webedia", firstName: "Jean", lastName: "Dupont" },
        totalNetAmount: 3000,
        totalAmountWithVat: 3600,
        createdAt: "2026-03-01",
      }),
    ).toEqual({
      legalName: "Webedia",
      firstName: "Jean",
      lastName: "Dupont",
      amount: 3000,
      createdAt: "2026-03-01",
    });
  });

  it("tolère un payload vide", () => {
    expect(dougsSideOf({})).toEqual({
      legalName: null,
      firstName: null,
      lastName: null,
      amount: null,
      createdAt: null,
    });
  });
});

// ---------------------------------------------------------------------
// Tris / bornes
// ---------------------------------------------------------------------

describe("sortByCreatedAtDesc", () => {
  it("trie du plus récent au plus ancien, les sans-date en dernier, sans muter", () => {
    const items = [
      { id: "b", createdAt: "2026-02-01" },
      { id: "none", createdAt: null },
      { id: "c", createdAt: "2026-03-01T10:00:00Z" },
      { id: "a", createdAt: "2026-01-01" },
    ];
    const sorted = sortByCreatedAtDesc(items);
    expect(sorted.map((i) => i.id)).toEqual(["c", "b", "a", "none"]);
    expect(items[0]?.id).toBe("b");
  });
});

describe("rankCandidates", () => {
  const cand = (id: string, total: number) => ({
    id,
    score: { total, name: 0, amount: 0, date: 0 },
  });

  it("garde les meilleurs scores, dans l'ordre, jusqu'à la limite", () => {
    const items = [cand("a", 0.4), cand("b", 0.9), cand("c", 0.6), cand("d", 0.5), cand("e", 0.95)];
    expect(rankCandidates(items, INVOICE_CANDIDATES_LIMIT).map((c) => c.id)).toEqual([
      "e",
      "b",
      "c",
      "d",
    ]);
    expect(items[0]?.id).toBe("a");
  });

  it("gère une liste vide", () => {
    expect(rankCandidates([], 3)).toEqual([]);
  });
});

describe("sortByBestCandidate", () => {
  const sugg = (id: string, totals: number[]) => ({
    id,
    candidates: totals.map((total) => ({ score: { total, name: 0, amount: 0, date: 0 } })),
  });

  it("classe par le score du 1er candidat, une suggestion sans candidat vaut 0", () => {
    const out = sortByBestCandidate([
      sugg("vide", []),
      sugg("moyen", [0.5, 0.9]),
      sugg("sur", [0.95]),
    ]);
    expect(out.map((s) => s.id)).toEqual(["sur", "moyen", "vide"]);
  });
});

describe("pMap", () => {
  it("préserve l'ordre des résultats malgré des durées différentes", async () => {
    const out = await pMap(
      [30, 5, 15],
      (ms, i) => new Promise<string>((r) => setTimeout(() => r(`${i}:${ms}`), ms)),
      3,
    );
    expect(out).toEqual(["0:30", "1:5", "2:15"]);
  });

  it("ne dépasse jamais la concurrence demandée", async () => {
    let inFlight = 0;
    let peak = 0;
    await pMap(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
      },
      4,
    );
    expect(peak).toBe(4);
  });

  it("renvoie [] pour une liste vide sans appeler fn", async () => {
    let calls = 0;
    const out = await pMap([], async () => {
      calls++;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Devis → projets
// ---------------------------------------------------------------------

describe("projectReferenceAmount", () => {
  it("prend la valeur, sinon le budget, en convertissant les numeric Postgres", () => {
    expect(projectReferenceAmount({ valueAmount: "12500.00", budgetAmount: "9000" })).toBe(12500);
    expect(projectReferenceAmount({ valueAmount: null, budgetAmount: "9000.50" })).toBe(9000.5);
  });

  it("renvoie null quand il n'y a pas de montant exploitable", () => {
    expect(projectReferenceAmount({ valueAmount: null, budgetAmount: null })).toBeNull();
    expect(projectReferenceAmount({ valueAmount: "0.00", budgetAmount: null })).toBeNull();
  });

  it("une valeur à 0 vaut « non renseigné » et laisse passer le budget", () => {
    expect(projectReferenceAmount({ valueAmount: "0.00", budgetAmount: "9000" })).toBe(9000);
    expect(projectReferenceAmount({ valueAmount: "0", budgetAmount: "0" })).toBeNull();
  });
});

describe("scoreQuoteProjectCandidates", () => {
  const dougs = {
    legalName: "Webedia",
    firstName: null,
    lastName: null,
    amount: 12000,
    createdAt: "2026-03-01",
  };
  const project = (id: string, entityName: string | null, valueAmount: string | null) => ({
    id,
    name: `Projet ${id}`,
    entityName,
    valueAmount,
    budgetAmount: null,
    startDate: "2026-03-03",
    createdAt: new Date("2026-01-01"),
  });

  it("propose le projet du bon client en premier", () => {
    const out = scoreQuoteProjectCandidates(dougs, [
      project("autre", "Boots & Cats", "12000"),
      project("webedia", "Webedia", "12000.00"),
    ]);
    expect(out.map((c) => c.projectId)).toEqual(["webedia"]);
    expect(out[0]?.valueAmount).toBe(12000);
    expect(out[0]?.score.total).toBe(1);
  });

  it("n'invente pas de candidat sur le seul montant + date", () => {
    expect(scoreQuoteProjectCandidates(dougs, [project("autre", "Boots & Cats", "12000")])).toEqual(
      [],
    );
  });

  it("borne à 3 candidats, du plus sûr au moins sûr", () => {
    const out = scoreQuoteProjectCandidates(dougs, [
      project("p1", "Webedia", "6000"), // montant faux
      project("p2", "Webedia", "12000"),
      project("p3", "Webedia", "11950"), // < 1 % d'écart
      project("p4", "Webedia", "13000"), // ~8 % d'écart
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.projectId)).toEqual(["p2", "p3", "p4"]);
    expect(out.every((c) => c.score.total >= PROPOSAL_THRESHOLD)).toBe(true);
  });

  it("un projet sans montant reste proposable sur le nom et la date", () => {
    const out = scoreQuoteProjectCandidates(dougs, [project("p", "Webedia", null)]);
    expect(out[0]?.valueAmount).toBeNull();
    expect(out[0]?.score.amount).toBe(0);
    expect(out[0]?.score.total).toBe(0.7);
  });
});

// ---------------------------------------------------------------------
// Factures → invoices existantes / nouveaux jalons
// ---------------------------------------------------------------------

describe("isMatchableInvoiceCandidate", () => {
  it("accepte jalons, coworking Parade et ponctuels", () => {
    expect(isMatchableInvoiceCandidate({ kind: "milestone", billedBy: null })).toBe(true);
    expect(isMatchableInvoiceCandidate({ kind: "coworking", billedBy: "parade" })).toBe(true);
    expect(isMatchableInvoiceCandidate({ kind: "one_off", billedBy: null })).toBe(true);
  });

  it("écarte les coworking facturés par G&O", () => {
    expect(isMatchableInvoiceCandidate({ kind: "coworking", billedBy: "g_and_o" })).toBe(false);
  });

  it("écarte devis et avoirs", () => {
    expect(isMatchableInvoiceCandidate({ kind: "quote", billedBy: null })).toBe(false);
    expect(isMatchableInvoiceCandidate({ kind: "credit_note", billedBy: null })).toBe(false);
  });
});

describe("invoiceCandidateLabel", () => {
  it("compose « Projet — jalon » et « Contrat — période », brut sinon", () => {
    expect(
      invoiceCandidateLabel({
        kind: "milestone",
        label: "Acompte 40 %",
        projectName: "Refonte",
        contractName: null,
      }),
    ).toBe("Refonte — Acompte 40 %");
    expect(
      invoiceCandidateLabel({
        kind: "coworking",
        label: "2026-03",
        projectName: null,
        contractName: "Contrat Toon",
      }),
    ).toBe("Contrat Toon — 2026-03");
    expect(
      invoiceCandidateLabel({
        kind: "one_off",
        label: "Atelier",
        projectName: null,
        contractName: null,
      }),
    ).toBe("Atelier");
  });

  it("met « ? » quand le parent est inconnu", () => {
    expect(
      invoiceCandidateLabel({
        kind: "milestone",
        label: "Solde",
        projectName: null,
        contractName: null,
      }),
    ).toBe("? — Solde");
  });
});

describe("scoreExistingInvoiceCandidate", () => {
  const dougs = {
    legalName: "Alice Martin",
    firstName: null,
    lastName: null,
    amount: 750,
    createdAt: "2026-02-01",
  };
  const coworking = {
    id: "inv-cw",
    kind: "coworking",
    label: "2026-02",
    amountHt: "750.00",
    projectName: null,
    contractName: "Contrat Alice",
    periodStart: "2026-02-01",
    createdAt: new Date("2025-12-15"),
  };

  it("retient la meilleure identité parmi celles du contrat coworking", () => {
    // Dougs facture la personne, le contrat est au nom de l'entité.
    const c = scoreExistingInvoiceCandidate(
      dougs,
      coworking,
      ["Acme SAS", "Alice Martin", "Contrat Alice"],
      "Acme SAS",
    );
    expect(c).not.toBeNull();
    expect(c?.score.name).toBe(1);
    expect(c?.score.total).toBe(1);
    expect(c?.entityName).toBe("Acme SAS");
    expect(c?.label).toBe("Contrat Alice — 2026-02");
    expect(c?.amountHt).toBe(750);
  });

  it("écarte un autre coworker au même loyer et à la même date", () => {
    expect(
      scoreExistingInvoiceCandidate(dougs, coworking, ["Contrat Yoann BUZENET"], "Yoann BUZENET"),
    ).toBeNull();
  });

  it("date la facture sur periodStart avant createdAt", () => {
    const c = scoreExistingInvoiceCandidate(dougs, coworking, ["Alice Martin"], null);
    expect(c?.score.date).toBe(1);
    const sansPeriode = scoreExistingInvoiceCandidate(
      dougs,
      { ...coworking, periodStart: null },
      ["Alice Martin"],
      null,
    );
    // createdAt = 2025-12-15, soit 48 jours avant : score date dégradé.
    expect(sansPeriode?.score.date).toBeLessThan(1);
    expect(sansPeriode?.score.date).toBeGreaterThan(0);
  });

  it("un montant null ou vide vaut 0 sans casser le scoring", () => {
    const c = scoreExistingInvoiceCandidate(
      dougs,
      { ...coworking, amountHt: null },
      ["Alice Martin"],
      null,
    );
    expect(c?.amountHt).toBe(0);
    expect(c?.score.amount).toBe(0);
    expect(c?.score.total).toBe(0.7);
  });

  it("sans aucune identité connue, le candidat est écarté", () => {
    expect(scoreExistingInvoiceCandidate(dougs, coworking, [], null)).toBeNull();
  });
});

describe("scoreNewProjectMilestoneCandidate", () => {
  const project = {
    id: "p1",
    name: "Refonte site",
    entityName: "Webedia",
    valueAmount: "10000.00",
    budgetAmount: null,
    startDate: "2026-03-03",
    createdAt: new Date("2026-01-01"),
  };
  const dougs = (amount: number, clientName = "Webedia") => ({
    clientName,
    amount,
    createdAt: "2026-03-01",
  });

  it("reconnaît un acompte de 40 % et propose le jalon", () => {
    const c = scoreNewProjectMilestoneCandidate(dougs(4000), project);
    expect(c).toMatchObject({
      kind: "new_project_milestone",
      projectId: "p1",
      projectValueHt: 10000,
      detectedPercent: 40,
      amountHt: 4000,
      score: { total: 1, name: 1, amount: 1, date: 1 },
    });
  });

  it("reconnaît un solde de 60 % avec des centimes", () => {
    const c = scoreNewProjectMilestoneCandidate(dougs(6000.01), project);
    expect(c?.detectedPercent).toBe(60);
    expect(c?.score.amount).toBe(1);
  });

  it("dégrade le score entre deux pourcentages standards et retient le premier", () => {
    // 45 % : à 5 pts de 40 et de 50 → 1 - (5 - 3) / 17 ; égalité → 40.
    const c = scoreNewProjectMilestoneCandidate(dougs(4500), project);
    expect(c?.detectedPercent).toBe(40);
    expect(c?.score.amount).toBeCloseTo(1 - 2 / 17, 6);
  });

  it("refuse un projet sans montant, même avec un nom parfait", () => {
    expect(
      scoreNewProjectMilestoneCandidate(dougs(4000), { ...project, valueAmount: null }),
    ).toBeNull();
    expect(
      scoreNewProjectMilestoneCandidate(dougs(4000), { ...project, valueAmount: "0.00" }),
    ).toBeNull();
  });

  it("retombe sur le budget si la valeur manque", () => {
    const c = scoreNewProjectMilestoneCandidate(dougs(4000), {
      ...project,
      valueAmount: null,
      budgetAmount: "10000",
    });
    expect(c?.projectValueHt).toBe(10000);
  });

  it("n'invente pas un jalon quand seul le montant tombe pile (plancher de nom)", () => {
    expect(scoreNewProjectMilestoneCandidate(dougs(4000, "Boots & Cats"), project)).toBeNull();
  });

  it("accepte le nom du projet quand Dougs facture au nom du projet", () => {
    const c = scoreNewProjectMilestoneCandidate(dougs(4000, "Refonte site"), project);
    expect(c?.score.name).toBe(1);
  });

  it("écarte un candidat qui passe le plancher mais reste sous le seuil global", () => {
    // Nom à 0.5 (2 tokens communs / 4), montant hors de tout %, pas de date.
    const c = scoreNewProjectMilestoneCandidate(
      { clientName: "Alpha Beta Gamma", amount: 10, createdAt: null },
      { ...project, entityName: "Beta Gamma Delta", startDate: null, createdAt: null },
    );
    expect(c).toBeNull();
  });

  it("arrondit le total à 3 décimales", () => {
    const c = scoreNewProjectMilestoneCandidate(dougs(4500), project);
    const expected = Math.round((0.5 + (1 - 2 / 17) * 0.3 + 0.2) * 1000) / 1000;
    expect(c?.score.total).toBe(expected);
  });
});

// ---------------------------------------------------------------------
// Déjà rattachés
// ---------------------------------------------------------------------

describe("classifyLinkedInvoiceRows", () => {
  const base = {
    label: "x",
    amountHt: "0",
    status: "sent",
    billedBy: null,
    projectId: null,
    coworkingContractId: null,
    dougsInvoiceId: null,
    dougsQuoteId: null,
    dougsReference: null,
    dougsStatus: null,
    projectName: null,
    projectEntityName: null,
    contractName: null,
  };

  it("répartit devis liés, factures liées et factures libres", () => {
    const out = classifyLinkedInvoiceRows([
      {
        ...base,
        id: "q1",
        kind: "quote",
        dougsQuoteId: "dq1",
        projectId: "p1",
        projectName: "Refonte",
        dougsStatus: "ACCEPTED",
      },
      {
        ...base,
        id: "m1",
        kind: "milestone",
        dougsInvoiceId: "di1",
        amountHt: "1200.50",
        status: "paid",
        projectId: "p1",
      },
      { ...base, id: "o1", kind: "one_off", amountHt: "300" },
    ]);
    expect(out.quotes.map((q) => q.invoiceId)).toEqual(["q1"]);
    expect(out.quotes[0]?.status).toBe("ACCEPTED");
    expect(out.invoices).toEqual([
      expect.objectContaining({
        invoiceId: "m1",
        dougsId: "di1",
        amountHt: 1200.5,
        status: "paid",
      }),
    ]);
    expect(out.freeInvoices).toEqual([expect.objectContaining({ id: "o1", amountHt: 300 })]);
  });

  it("ignore un devis sans projet ou sans lien Dougs", () => {
    const out = classifyLinkedInvoiceRows([
      { ...base, id: "q1", kind: "quote", dougsQuoteId: "dq1" },
      { ...base, id: "q2", kind: "quote", projectId: "p1" },
    ]);
    expect(out.quotes).toEqual([]);
    expect(out.freeInvoices).toEqual([]);
  });

  it("ignore les coworking G&O même liés, et les avoirs", () => {
    const out = classifyLinkedInvoiceRows([
      { ...base, id: "cw", kind: "coworking", billedBy: "g_and_o", dougsInvoiceId: "di" },
      { ...base, id: "cn", kind: "credit_note", dougsInvoiceId: "di2" },
    ]);
    expect(out).toEqual({ quotes: [], invoices: [], freeInvoices: [] });
  });

  it("affiche « ? » pour un devis dont le projet n'a plus de nom", () => {
    const out = classifyLinkedInvoiceRows([
      { ...base, id: "q1", kind: "quote", dougsQuoteId: "dq1", projectId: "p1" },
    ]);
    expect(out.quotes[0]?.projectName).toBe("?");
  });

  it("un montant illisible vaut 0", () => {
    const out = classifyLinkedInvoiceRows([{ ...base, id: "o1", kind: "one_off", amountHt: null }]);
    expect(out.freeInvoices[0]?.amountHt).toBe(0);
  });
});
