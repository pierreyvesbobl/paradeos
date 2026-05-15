import "server-only";

import { coworkingContracts, coworkingInvoices } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { listDougsQuotes, listDougsSalesInvoices } from "@/lib/dougs/client";
import {
  type MatchScore,
  scoreMatch,
  similarityAmountPartial,
  similarityDate,
  similarityName,
} from "@/lib/dougs/match";
import { eq } from "drizzle-orm";

export type DougsClientName = {
  legalName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

function dougsName(c: DougsClientName | null | undefined): string {
  if (!c) return "—";
  return c.legalName ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ?? "—";
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
  const unlinkedQuotes = dougsQuotes.filter((q) => !linkedQuoteIds.has(q.id));

  // 3. Pour chaque devis Dougs non lié, calcule top 3 candidats Paradeos.
  const out: QuoteSuggestion[] = [];
  for (const q of unlinkedQuotes) {
    const dougsAmount =
      typeof q.totalNetAmount === "number" ? q.totalNetAmount : (q.totalAmountWithVat ?? null);
    const scored = candidates
      .map((c) => {
        const paradeosAmount = Number(c.valueAmount ?? c.budgetAmount ?? 0) || null;
        const score = scoreMatch(
          {
            legalName: q.clientData?.legalName ?? null,
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
        totalHt: typeof q.totalNetAmount === "number" ? q.totalNetAmount : null,
        totalTtc: typeof q.totalAmountWithVat === "number" ? q.totalAmountWithVat : null,
        clientName: dougsName(q.clientData),
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
  };
  candidates: InvoiceCandidate[];
};

export async function getInvoiceSuggestions(userId: string): Promise<InvoiceSuggestion[]> {
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

  // 1b. Factures coworking sans dougsInvoiceId.
  const coworkingCandidates = await conn
    .select({
      id: coworkingInvoices.id,
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
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId));

  const unlinkedCoworking = coworkingCandidates.filter((c) => !c.dougsInvoiceId);

  // 2. Factures Dougs : récupère, exclut déjà liées.
  const dougsInvoices = await listDougsSalesInvoices(userId, { limit: 200 });

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
  const unlinkedInvoices = dougsInvoices.filter((i) => !linkedInvoiceIds.has(i.id));

  // 3. Pour chaque facture Dougs non liée, score contre jalons + coworking.
  const out: InvoiceSuggestion[] = [];
  for (const inv of unlinkedInvoices) {
    const dougsAmount =
      typeof inv.totalNetAmount === "number"
        ? inv.totalNetAmount
        : (inv.totalAmountWithVat ?? null);

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
            legalName: inv.clientData?.legalName ?? null,
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
        const localAmount = Number(c.unitPriceHt) * c.desks;
        return {
          kind: "coworking" as const,
          coworkingInvoiceId: c.id,
          contractName: c.contractName,
          entityName: c.billToEntityName,
          name: c.name,
          amountHt: localAmount,
          score: scoreMatch(
            {
              legalName: inv.clientData?.legalName ?? null,
              firstName: inv.clientData?.firstName ?? null,
              lastName: inv.clientData?.lastName ?? null,
              amount: dougsAmount,
              createdAt: inv.createdAt ?? null,
            },
            {
              clientName: c.billToEntityName ?? c.contractName,
              amount: localAmount,
              date: c.invoiceDate ?? c.periodStart,
            },
          ),
        };
      })
      .filter((x) => x.score.total >= 0.3);

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

        const nameSim = similarityName(
          inv.clientData?.legalName ??
            `${inv.clientData?.firstName ?? ""} ${inv.clientData?.lastName ?? ""}`.trim(),
          p.entityName,
        );
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

    const all = [...milestoneScored, ...coworkingScored, ...projectScoredFiltered]
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 4);

    out.push({
      dougs: {
        id: inv.id,
        reference: inv.reference ?? null,
        status: inv.status ?? null,
        totalHt: typeof inv.totalNetAmount === "number" ? inv.totalNetAmount : null,
        totalTtc: typeof inv.totalAmountWithVat === "number" ? inv.totalAmountWithVat : null,
        clientName: dougsName(inv.clientData),
        createdAt: inv.createdAt ?? null,
        paidAt: inv.paidAt ?? null,
      },
      candidates: all,
    });
  }

  out.sort((a, b) => (b.candidates[0]?.score.total ?? 0) - (a.candidates[0]?.score.total ?? 0));
  return out;
}
