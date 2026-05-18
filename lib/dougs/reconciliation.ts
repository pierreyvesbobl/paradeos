import "server-only";

import { contacts } from "@/db/schema/contacts";
import { coworkingContracts, coworkingInvoices } from "@/db/schema/coworking";

/**
 * Map async avec concurrency cap. Évite de saturer Dougs (Cloudflare
 * rate-limit) avec un Promise.all de 50 GET d'un coup. Conserve l'ordre
 * du tableau d'entrée.
 */
async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
import { dougsCreditNoteLinks } from "@/db/schema/dougs";
import { entities } from "@/db/schema/entities";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import {
  type DougsQuote,
  type DougsSalesInvoice,
  getDougsQuote,
  getDougsSalesInvoice,
  listDougsQuotes,
  listDougsSalesInvoices,
  pickDougsClientName,
} from "@/lib/dougs/client";
import {
  type MatchScore,
  scoreMatch,
  similarityAmountPartial,
  similarityDate,
  similarityName,
} from "@/lib/dougs/match";
import { monthsBetween } from "@/lib/schemas/coworking";
import { eq, inArray } from "drizzle-orm";

export type DougsClientName = {
  legalName?: string | null;
  /** Champ utilisé dans le payload "liste compacte" (ex : Arthur Heynard). */
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * Récupère le nom client peu importe la forme de payload Dougs.
 * Le endpoint /sales-invoices renvoie `clientData.name` (compacte) ou
 * `clientData.legalName` (détail Angular complet) ou même `clientName`
 * en racine. Idem pour les devis.
 */
function dougsName(
  c: DougsClientName | null | undefined,
  fallbackClientName?: string | null,
): string {
  const fromObj = c?.legalName ?? c?.name ?? `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  const v = fromObj || fallbackClientName || "";
  return v || "—";
}

/**
 * Extrait le montant HT depuis n'importe quel format Dougs.
 * Detail Angular : `totalNetAmount`. Liste compacte : `netAmount`.
 */
function pickHt(o: { totalNetAmount?: number | null; netAmount?: unknown }): number | null {
  if (typeof o.totalNetAmount === "number") return o.totalNetAmount;
  if (typeof o.netAmount === "number") return o.netAmount;
  return null;
}

/** Extrait le montant TTC : `totalAmountWithVat` ou `amount`. */
function pickTtc(o: { totalAmountWithVat?: number | null; amount?: unknown }): number | null {
  if (typeof o.totalAmountWithVat === "number") return o.totalAmountWithVat;
  if (typeof o.amount === "number") return o.amount;
  return null;
}

export type QuoteSuggestion = {
  dougs: {
    id: string;
    reference: string | null;
    status: string | null;
    totalHt: number | null;
    totalTtc: number | null;
    clientName: string;
    createdAt: string | null;
  };
  candidates: {
    projectId: string;
    projectName: string;
    entityName: string | null;
    valueAmount: number | null;
    score: MatchScore;
  }[];
};

export async function getQuoteSuggestions(userId: string): Promise<QuoteSuggestion[]> {
  const conn = await db();

  // 1. Projets client sans devis Dougs lié.
  const unlinkedProjects = await conn
    .select({
      id: projects.id,
      name: projects.name,
      valueAmount: projects.valueAmount,
      budgetAmount: projects.budgetAmount,
      startDate: projects.startDate,
      createdAt: projects.createdAt,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.dougsQuoteId, "")); // intentionally never matches — placeholder

  // Note: drizzle `isNull(projects.dougsQuoteId)` would be cleaner ; on
  // récupère tout puis on filtre côté JS pour rester simple.
  const allClientProjects = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      dougsQuoteId: projects.dougsQuoteId,
      valueAmount: projects.valueAmount,
      budgetAmount: projects.budgetAmount,
      startDate: projects.startDate,
      createdAt: projects.createdAt,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId));

  const candidates = allClientProjects.filter((p) => p.kind === "client" && !p.dougsQuoteId);
  // Silence le résultat non utilisé du premier select.
  void unlinkedProjects;

  // 2. Devis Dougs : récupère tous, exclut ceux déjà liés à un projet.
  const dougsQuotes = await listDougsQuotes(userId, { limit: 200 });
  const linkedQuoteIds = new Set(
    allClientProjects.map((p) => p.dougsQuoteId).filter((x): x is string => !!x),
  );
  const unlinkedQuotesList = dougsQuotes.filter((q) => !linkedQuoteIds.has(q.id));

  // Enrichissement : le endpoint /quotes (liste) ne renvoie pas
  // clientData ni les totaux complets. On fetch chaque devis individu-
  // ellement pour avoir le détail. Cappé à 50 entrées pour éviter de
  // saturer Dougs sur une grosse base.
  const enrichedQuotes: (DougsQuote & { id: string })[] = await pMap(
    unlinkedQuotesList.slice(0, 50),
    async (q) => {
      try {
        const detail = await getDougsQuote(userId, q.id);
        return { ...q, ...detail, id: q.id } as DougsQuote & { id: string };
      } catch (err) {
        console.warn(
          `[rapprochement] enrich quote ${q.id} failed:`,
          err instanceof Error ? err.message : err,
        );
        return { ...q, id: q.id } as DougsQuote & { id: string };
      }
    },
    5,
  );
  const unlinkedQuotes = enrichedQuotes;

  // 3. Pour chaque devis Dougs non lié, calcule top 3 candidats Paradeos.
  const out: QuoteSuggestion[] = [];
  for (const q of unlinkedQuotes) {
    const dougsAmount = pickHt(q) ?? pickTtc(q);
    const dougsClientName = pickDougsClientName(q);
    const scored = candidates
      .map((c) => {
        const paradeosAmount = Number(c.valueAmount ?? c.budgetAmount ?? 0) || null;
        const score = scoreMatch(
          {
            legalName: dougsClientName,
            firstName: q.clientData?.firstName ?? null,
            lastName: q.clientData?.lastName ?? null,
            amount: dougsAmount,
            createdAt: q.createdAt ?? null,
          },
          {
            clientName: c.entityName,
            amount: paradeosAmount,
            date: c.startDate ?? c.createdAt,
          },
        );
        return {
          projectId: c.id,
          projectName: c.name,
          entityName: c.entityName,
          valueAmount: paradeosAmount,
          score,
        };
      })
      .filter((x) => x.score.total >= 0.3)
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 3);

    out.push({
      dougs: {
        id: q.id,
        reference: q.reference ?? null,
        status: q.status ?? null,
        totalHt: pickHt(q),
        totalTtc: pickTtc(q),
        clientName: dougsName(q.clientData, (q as { clientName?: string }).clientName ?? null),
        createdAt: q.createdAt ?? null,
      },
      candidates: scored,
    });
  }

  // Tri : meilleur score décroissant en haut.
  out.sort((a, b) => (b.candidates[0]?.score.total ?? 0) - (a.candidates[0]?.score.total ?? 0));
  return out;
}

// ------------- Factures -------------

export type InvoiceCandidate =
  | {
      kind: "milestone";
      projectId: string;
      milestoneId: string;
      projectName: string;
      entityName: string | null;
      label: string;
      amountHt: number;
      score: MatchScore;
    }
  | {
      kind: "coworking";
      coworkingInvoiceId: string;
      contractName: string | null;
      entityName: string | null;
      name: string;
      amountHt: number;
      /** Date d'émission (YYYY-MM-DD) si la facture coworking est émise. */
      invoiceDate: string | null;
      periodStart: string;
      periodEnd: string;
      score: MatchScore;
    }
  | {
      // Projet client sans jalon correspondant — propose de créer un
      // nouveau jalon à la volée si le ratio facture/projet ressemble à
      // un % standard (acompte 30/40/50, solde 50/60/70, full 100).
      kind: "project";
      projectId: string;
      projectName: string;
      entityName: string | null;
      projectValueHt: number;
      /** % détecté entre la facture et le total projet (null si full match). */
      detectedPercent: number | null;
      /** Montant qu'aura le nouveau jalon (= montant facture). */
      amountHt: number;
      score: MatchScore;
    }
  | {
      // Contrat coworking sans facture Paradeos pour la période — propose
      // de créer une nouvelle coworking_invoice à la volée pour ce contrat,
      // déduisant la période depuis la date de la facture Dougs.
      kind: "coworking-contract";
      contractId: string;
      contractName: string;
      entityName: string | null;
      monthlyHt: number;
      desks: number;
      amountHt: number;
      score: MatchScore;
    };

export type InvoiceSuggestion = {
  dougs: {
    id: string;
    reference: string | null;
    status: string | null;
    totalHt: number | null;
    totalTtc: number | null;
    clientName: string;
    createdAt: string | null;
    paidAt: string | null;
    /** Présent uniquement en mode debug — payload brut Dougs. */
    debugRaw?: unknown;
  };
  candidates: InvoiceCandidate[];
};

export type DougsInvoiceOption = {
  id: string;
  reference: string | null;
  clientName: string;
  totalHt: number | null;
  createdAt: string | null;
};

export type CreditNoteEntry = {
  dougs: {
    id: string;
    reference: string | null;
    status: string | null;
    totalHt: number | null;
    totalTtc: number | null;
    clientName: string;
    createdAt: string | null;
  };
  /** Lien stocké côté Paradeos vers la facture annulée (null = non lié). */
  link: {
    cancelsDougsInvoiceId: string;
    invoice: { reference: string | null; clientName: string; totalHt: number | null } | null;
  } | null;
};

export type InvoiceSuggestionsResult = {
  invoices: InvoiceSuggestion[];
  creditNotes: CreditNoteEntry[];
  /** Toutes les factures Dougs (hors avoirs) — sert au picker de liaison d'avoir. */
  invoiceOptions: DougsInvoiceOption[];
};

export async function getInvoiceSuggestions(
  userId: string,
  opts: { debug?: boolean } = {},
): Promise<InvoiceSuggestionsResult> {
  console.info("[rapprochement] getInvoiceSuggestions start");
  const conn = await db();

  // 1a. Jalons projet sans dougsInvoiceId. On charge aussi valueAmount
  // et budgetAmount pour pouvoir scorer en mode "acompte/solde" plus
  // bas (un projet 10k€ peut recevoir une facture de 4k€ = acompte 40%).
  const allProjects = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      startDate: projects.startDate,
      createdAt: projects.createdAt,
      valueAmount: projects.valueAmount,
      budgetAmount: projects.budgetAmount,
      billingMilestones: projects.billingMilestones,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId));

  type MilestoneCand = {
    projectId: string;
    projectName: string;
    entityName: string | null;
    date: string | Date | null;
    milestone: BillingMilestone;
  };
  const milestoneCandidates: MilestoneCand[] = [];
  for (const p of allProjects) {
    if (p.kind !== "client") continue;
    const ms = (p.billingMilestones ?? []) as BillingMilestone[];
    for (const m of ms) {
      if (!m.dougsInvoiceId) {
        milestoneCandidates.push({
          projectId: p.id,
          projectName: p.name,
          entityName: p.entityName,
          date: p.startDate ?? p.createdAt,
          milestone: m,
        });
      }
    }
  }

  // 1b. Factures coworking sans dougsInvoiceId. Join sur le contact
  // (occupant du poste) pour matcher les factures B2C, où Dougs renvoie
  // un nom de personne plutôt qu'un nom d'entité.
  const coworkingCandidates = await conn
    .select({
      id: coworkingInvoices.id,
      contractId: coworkingInvoices.contractId,
      name: coworkingInvoices.name,
      desks: coworkingInvoices.desks,
      unitPriceHt: coworkingInvoices.unitPriceHt,
      vatRate: coworkingInvoices.vatRate,
      periodStart: coworkingInvoices.periodStart,
      periodEnd: coworkingInvoices.periodEnd,
      invoiceDate: coworkingInvoices.invoiceDate,
      createdAt: coworkingInvoices.createdAt,
      dougsInvoiceId: coworkingInvoices.dougsInvoiceId,
      contractName: coworkingContracts.name,
      billToEntityId: coworkingContracts.billToEntityId,
      billToEntityName: entities.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId));

  const unlinkedCoworking = coworkingCandidates.filter((c) => !c.dougsInvoiceId);

  // Contrats coworking en cours, indépendamment des factures Paradeos
  // déjà émises. Servent à matcher les factures Dougs qui n'ont pas
  // encore d'équivalent en facture Paradeos (= on créera la facture
  // coworking à la volée au moment du lien).
  const contractCandidates = await conn
    .select({
      id: coworkingContracts.id,
      name: coworkingContracts.name,
      contactId: coworkingContracts.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      billToEntityId: coworkingContracts.billToEntityId,
      billToEntityName: entities.name,
      desks: coworkingContracts.desks,
      unitPriceHt: coworkingContracts.unitPriceHt,
      startDate: coworkingContracts.startDate,
      billingFrequency: coworkingContracts.billingFrequency,
      status: coworkingContracts.status,
    })
    .from(coworkingContracts)
    .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId));

  // 2. Factures Dougs : récupère tout, sépare avoirs (montant < 0) des
  // factures normales pour éviter qu'un avoir négatif "matche" un jalon
  // positif à l'envers.
  const dougsInvoicesAll = await listDougsSalesInvoices(userId, { limit: 200 });
  console.info(`[rapprochement] listDougsSalesInvoices → ${dougsInvoicesAll.length} entries`);

  const dougsInvoices: typeof dougsInvoicesAll = [];
  const dougsCreditNotes: typeof dougsInvoicesAll = [];
  for (const i of dougsInvoicesAll) {
    const ht = pickHt(i);
    const ttc = pickTtc(i);
    const isCredit = (typeof ht === "number" && ht < 0) || (typeof ttc === "number" && ttc < 0);
    if (isCredit) dougsCreditNotes.push(i);
    else dougsInvoices.push(i);
  }
  console.info(
    `[rapprochement] split: ${dougsInvoices.length} factures, ${dougsCreditNotes.length} avoirs`,
  );

  // Collect linked invoice ids from milestones + coworking
  const linkedInvoiceIds = new Set<string>();
  for (const p of allProjects) {
    const ms = (p.billingMilestones ?? []) as BillingMilestone[];
    for (const m of ms) {
      if (m.dougsInvoiceId) linkedInvoiceIds.add(m.dougsInvoiceId);
    }
  }
  for (const c of coworkingCandidates) {
    if (c.dougsInvoiceId) linkedInvoiceIds.add(c.dougsInvoiceId);
  }
  const unlinkedInvoicesList = dougsInvoices.filter((i) => !linkedInvoiceIds.has(i.id));
  console.info(
    `[rapprochement] unlinked invoices: ${unlinkedInvoicesList.length} (linked: ${linkedInvoiceIds.size})`,
  );

  // Enrichissement (cf. quotes plus haut) : le endpoint liste ne renvoie
  // pas clientData ni les totaux complets. Fetch chaque facture en
  // détail. Cappé à 50.
  let enrichSuccess = 0;
  let enrichFail = 0;
  const unlinkedInvoices: (DougsSalesInvoice & { id: string })[] = await pMap(
    unlinkedInvoicesList.slice(0, 50),
    async (i) => {
      try {
        const detail = await getDougsSalesInvoice(userId, i.id);
        enrichSuccess++;
        return { ...i, ...detail, id: i.id } as DougsSalesInvoice & { id: string };
      } catch (err) {
        enrichFail++;
        console.warn(
          `[rapprochement] enrich invoice ${i.id} failed:`,
          err instanceof Error ? err.message : err,
        );
        return { ...i, id: i.id } as DougsSalesInvoice & { id: string };
      }
    },
    5,
  );
  console.info(`[rapprochement] invoice enrichment: ${enrichSuccess} success, ${enrichFail} fail`);

  // 3. Pour chaque facture Dougs non liée, score contre jalons + coworking.
  const out: InvoiceSuggestion[] = [];
  for (const inv of unlinkedInvoices) {
    const dougsAmount = pickHt(inv) ?? pickTtc(inv);
    // Nom client Dougs résolu peu importe le schéma (compact / détail).
    // On le passe via `legalName` à scoreMatch (qui sait le lire en priorité).
    const dougsClientName = pickDougsClientName(inv);

    const milestoneScored: InvoiceCandidate[] = milestoneCandidates
      .map((c) => ({
        kind: "milestone" as const,
        projectId: c.projectId,
        milestoneId: c.milestone.id,
        projectName: c.projectName,
        entityName: c.entityName,
        label: c.milestone.label,
        amountHt: c.milestone.amountHt,
        score: scoreMatch(
          {
            legalName: dougsClientName,
            firstName: inv.clientData?.firstName ?? null,
            lastName: inv.clientData?.lastName ?? null,
            amount: dougsAmount,
            createdAt: inv.createdAt ?? null,
          },
          {
            clientName: c.entityName,
            amount: c.milestone.amountHt,
            date: c.date,
          },
        ),
      }))
      .filter((x) => x.score.total >= 0.3);

    const coworkingScored: InvoiceCandidate[] = unlinkedCoworking
      .map((c) => {
        // Montant réel facture = mensuel × postes × nb mois dans la
        // période. Sans le facteur mois, toutes les factures d'un même
        // contrat ont le même montant et le scoring ne peut pas les
        // distinguer entre factures Dougs Q1/Q2/Q3 du même client.
        const months = monthsBetween(c.periodStart, c.periodEnd);
        const localAmount = Number(c.unitPriceHt) * c.desks * months;
        // Nom client côté Paradeos : entité de facturation (B2B) en
        // priorité, sinon nom du contact occupant (B2C), sinon nom du
        // contrat — jamais le nom de la facture (ex. "Coworking Q1") qui
        // n'a aucun lien avec le client.
        const contactName = `${c.contactFirstName ?? ""} ${c.contactLastName ?? ""}`.trim() || null;
        const paradeosClient = c.billToEntityName ?? contactName ?? c.contractName;
        return {
          kind: "coworking" as const,
          coworkingInvoiceId: c.id,
          contractName: c.contractName,
          entityName: c.billToEntityName ?? contactName,
          name: c.name,
          amountHt: localAmount,
          invoiceDate: c.invoiceDate,
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
          score: scoreMatch(
            {
              legalName: dougsClientName,
              firstName: inv.clientData?.firstName ?? null,
              lastName: inv.clientData?.lastName ?? null,
              amount: dougsAmount,
              createdAt: inv.createdAt ?? null,
            },
            {
              clientName: paradeosClient,
              amount: localAmount,
              date: c.invoiceDate ?? c.periodStart,
            },
          ),
        };
      })
      .filter((x) => x.score.total >= 0.3);

    // Candidats "contrat coworking" : contrat dont le client matche la
    // facture Dougs. Le montant attendu pour 1 mois = unitPriceHt * desks,
    // pour 3 mois (trimestriel) = × 3. On teste les deux ratios.
    const contractScored: InvoiceCandidate[] = [];
    for (const ct of contractCandidates) {
      const contactName = `${ct.contactFirstName ?? ""} ${ct.contactLastName ?? ""}`.trim() || null;
      const clientName = ct.billToEntityName ?? contactName ?? ct.name;
      const nameSim = similarityName(dougsClientName, clientName);
      if (nameSim < 0.4) continue;

      const monthlyHt = Number(ct.unitPriceHt) * ct.desks;
      const period = ct.billingFrequency === "quarterly" ? 3 : 1;
      const expectedAmount = monthlyHt * period;
      const amountSim =
        typeof dougsAmount === "number" && dougsAmount > 0 && expectedAmount > 0
          ? 1 - Math.min(1, Math.abs(dougsAmount - expectedAmount) / expectedAmount)
          : 0;
      // Date : on n'a pas de période précise sans facture, donc bonus
      // si le contrat est en cours (statut en_cours) au moment de la
      // facture, sinon 0.
      const dateSim = ct.status === "en_cours" ? 0.5 : 0;
      const total = Math.round((nameSim * 0.5 + amountSim * 0.3 + dateSim * 0.2) * 1000) / 1000;
      if (total < 0.4) continue;

      contractScored.push({
        kind: "coworking-contract",
        contractId: ct.id,
        contractName: ct.name,
        entityName: ct.billToEntityName ?? contactName,
        monthlyHt,
        desks: ct.desks,
        amountHt: dougsAmount ?? expectedAmount,
        score: { total, name: nameSim, amount: amountSim, date: dateSim },
      });
    }

    // Pour chaque contrat matché, on remonte aussi ses factures
    // coworking non liées comme candidats `coworking` — héritent du
    // score du contrat. Évite que l'user crée une facture en doublon
    // alors qu'une existe mais dont le score individuel n'a pas
    // dépassé le seuil 0.3 (cas vu : montant attendu ne matche pas
    // parfaitement la facture Dougs, ou date trop loin).
    const matchedContractIds = new Set(
      contractScored
        .filter(
          (c): c is Extract<InvoiceCandidate, { kind: "coworking-contract" }> =>
            c.kind === "coworking-contract",
        )
        .map((c) => c.contractId),
    );
    const alreadyScoredInvoiceIds = new Set(
      coworkingScored
        .filter(
          (c): c is Extract<InvoiceCandidate, { kind: "coworking" }> => c.kind === "coworking",
        )
        .map((c) => c.coworkingInvoiceId),
    );
    const inheritedCoworkingScored: InvoiceCandidate[] = [];
    for (const ct of contractScored) {
      if (ct.kind !== "coworking-contract") continue;
      const facturesOfContract = unlinkedCoworking.filter(
        (cwi) => cwi.contractId === ct.contractId && !alreadyScoredInvoiceIds.has(cwi.id),
      );
      for (const cwi of facturesOfContract) {
        const months = monthsBetween(cwi.periodStart, cwi.periodEnd);
        const localAmount = Number(cwi.unitPriceHt) * cwi.desks * months;
        const contactName =
          `${cwi.contactFirstName ?? ""} ${cwi.contactLastName ?? ""}`.trim() || null;
        inheritedCoworkingScored.push({
          kind: "coworking",
          coworkingInvoiceId: cwi.id,
          contractName: cwi.contractName,
          entityName: cwi.billToEntityName ?? contactName,
          name: cwi.name,
          amountHt: localAmount,
          invoiceDate: cwi.invoiceDate,
          periodStart: cwi.periodStart,
          periodEnd: cwi.periodEnd,
          // Score "name" hérité du contrat ; on garde le score amount
          // (souvent faible quand mal aligné) pour signaler la
          // divergence, mais le total reste au moins celui du contrat.
          score: {
            total: Math.max(ct.score.total - 0.05, ct.score.name * 0.5),
            name: ct.score.name,
            amount: 0,
            date: 0,
          },
        });
      }
    }

    // Filtre : on cache le candidat "contrat coworking" si on a réussi
    // à surfacer au moins une facture pour ce contrat (la facture
    // existante est toujours préférable à un duplicate).
    const contractsWithFactureCandidate = new Set(
      [...coworkingScored, ...inheritedCoworkingScored]
        .filter((c) => c.kind === "coworking")
        .map((c) => {
          const found = unlinkedCoworking.find(
            (cwi) => c.kind === "coworking" && cwi.id === c.coworkingInvoiceId,
          );
          return found?.contractId;
        })
        .filter((x): x is string => !!x),
    );
    void matchedContractIds;
    const contractScoredFiltered = contractScored.filter((c) =>
      c.kind === "coworking-contract" ? !contractsWithFactureCandidate.has(c.contractId) : true,
    );

    // Merge factures héritées dans coworkingScored.
    const coworkingScoredFinal = [...coworkingScored, ...inheritedCoworkingScored];

    // Candidats "projet" : projets client dont le montant total tombe
    // sur un % standard (acompte/solde/full) par rapport à la facture.
    // Permet de détecter "cette facture est probablement l'acompte 40%
    // du projet X" même si le total projet ≠ total facture.
    const projectScored: InvoiceCandidate[] = [];
    if (typeof dougsAmount === "number" && dougsAmount > 0) {
      for (const p of allProjects) {
        if (p.kind !== "client") continue;
        const projectValueHt = Number(p.valueAmount ?? p.budgetAmount ?? 0);
        if (projectValueHt <= 0) continue;

        const nameSim = similarityName(dougsClientName, p.entityName);
        const partial = similarityAmountPartial(dougsAmount, projectValueHt);
        const dateSim = similarityDate(inv.createdAt ?? null, p.startDate ?? p.createdAt);
        const total =
          Math.round((nameSim * 0.5 + partial.score * 0.3 + dateSim * 0.2) * 1000) / 1000;
        if (total < 0.3) continue;

        projectScored.push({
          kind: "project",
          projectId: p.id,
          projectName: p.name,
          entityName: p.entityName,
          projectValueHt,
          detectedPercent: partial.percent,
          amountHt: dougsAmount,
          score: { total, name: nameSim, amount: partial.score, date: dateSim },
        });
      }
    }

    // Filtre les doublons : si un jalon existant déjà candidat couvre
    // le même projet, on retire le candidat "projet" (le jalon est
    // toujours préféré, plus précis).
    const projectsWithMilestoneCandidate = new Set(
      milestoneScored
        .filter(
          (c): c is Extract<InvoiceCandidate, { kind: "milestone" }> => c.kind === "milestone",
        )
        .map((c) => c.projectId),
    );
    const projectScoredFiltered = projectScored.filter((c) =>
      c.kind === "project" ? !projectsWithMilestoneCandidate.has(c.projectId) : true,
    );

    const all = [
      ...milestoneScored,
      ...coworkingScoredFinal,
      ...contractScoredFiltered,
      ...projectScoredFiltered,
    ]
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 4);

    out.push({
      dougs: {
        id: inv.id,
        reference: inv.reference ?? null,
        // status Dougs varie : Angular full → "status", liste compacte → "paymentStatus".
        status: inv.status ?? (inv as { paymentStatus?: string }).paymentStatus ?? null,
        totalHt: pickHt(inv),
        totalTtc: pickTtc(inv),
        clientName: dougsName(inv.clientData, (inv as { clientName?: string }).clientName ?? null),
        createdAt: inv.createdAt ?? null,
        paidAt: inv.paidAt ?? null,
        debugRaw: opts.debug ? inv : undefined,
      },
      candidates: all,
    });
  }

  out.sort((a, b) => (b.candidates[0]?.score.total ?? 0) - (a.candidates[0]?.score.total ?? 0));

  // 4. Avoirs : enrichissement + résolution du lien Paradeos
  // (dougs_credit_note_links). Beaucoup moins nombreux que les factures
  // (quelques par an), on les enrichit tous sans cap.
  const enrichedCreditNotes: (DougsSalesInvoice & { id: string })[] = await pMap(
    dougsCreditNotes,
    async (i) => {
      try {
        const detail = await getDougsSalesInvoice(userId, i.id);
        return { ...i, ...detail, id: i.id } as DougsSalesInvoice & { id: string };
      } catch (err) {
        console.warn(
          `[rapprochement] enrich credit note ${i.id} failed:`,
          err instanceof Error ? err.message : err,
        );
        return { ...i, id: i.id } as DougsSalesInvoice & { id: string };
      }
    },
    5,
  );

  const creditNoteIds = enrichedCreditNotes.map((cn) => cn.id);
  const links = creditNoteIds.length
    ? await conn
        .select({
          dougsCreditNoteId: dougsCreditNoteLinks.dougsCreditNoteId,
          cancelsDougsInvoiceId: dougsCreditNoteLinks.cancelsDougsInvoiceId,
        })
        .from(dougsCreditNoteLinks)
        .where(inArray(dougsCreditNoteLinks.dougsCreditNoteId, creditNoteIds))
    : [];
  const linksByCn = new Map(links.map((l) => [l.dougsCreditNoteId, l.cancelsDougsInvoiceId]));

  // Index des factures Dougs par id pour lookup rapide du "cancels".
  const invoicesById = new Map(dougsInvoices.map((i) => [i.id, i]));

  const creditNotes: CreditNoteEntry[] = enrichedCreditNotes.map((cn) => {
    const cancelsId = linksByCn.get(cn.id) ?? null;
    const cancels = cancelsId ? (invoicesById.get(cancelsId) ?? null) : null;
    return {
      dougs: {
        id: cn.id,
        reference: cn.reference ?? null,
        status: cn.status ?? (cn as { paymentStatus?: string }).paymentStatus ?? null,
        totalHt: pickHt(cn),
        totalTtc: pickTtc(cn),
        clientName: pickDougsClientName(cn) ?? "—",
        createdAt: cn.createdAt ?? null,
      },
      link: cancelsId
        ? {
            cancelsDougsInvoiceId: cancelsId,
            invoice: cancels
              ? {
                  reference: cancels.reference ?? null,
                  clientName: pickDougsClientName(cancels) ?? "—",
                  totalHt: pickHt(cancels),
                }
              : null,
          }
        : null,
    };
  });

  // Picker options : toutes les factures normales (hors avoirs), récent
  // d'abord. Permet à l'utilisateur de choisir quelle facture l'avoir annule.
  const invoiceOptions: DougsInvoiceOption[] = dougsInvoices
    .map((i) => ({
      id: i.id,
      reference: i.reference ?? null,
      clientName: pickDougsClientName(i) ?? "—",
      totalHt: pickHt(i),
      createdAt: i.createdAt ?? null,
    }))
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });

  return { invoices: out, creditNotes, invoiceOptions };
}
