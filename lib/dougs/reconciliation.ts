import "server-only";

import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
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
import { and, eq, isNull } from "drizzle-orm";

/**
 * Map async avec concurrency cap. Évite de saturer Dougs (Cloudflare
 * rate-limit) avec un Promise.all de 50 GET d'un coup.
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

function dougsName(
  c:
    | {
        legalName?: string | null;
        name?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      }
    | null
    | undefined,
  fallback?: string | null,
): string {
  const fromObj = c?.legalName ?? c?.name ?? `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  const v = fromObj || fallback || "";
  return v || "—";
}

function pickHt(o: { totalNetAmount?: number | null; netAmount?: unknown }): number | null {
  if (typeof o.totalNetAmount === "number") return o.totalNetAmount;
  if (typeof o.netAmount === "number") return o.netAmount;
  return null;
}

function pickTtc(o: { totalAmountWithVat?: number | null; amount?: unknown }): number | null {
  if (typeof o.totalAmountWithVat === "number") return o.totalAmountWithVat;
  if (typeof o.amount === "number") return o.amount;
  return null;
}

function negate(n: number | null): number | null {
  if (n === null) return null;
  return n === 0 ? 0 : -Math.abs(n);
}

// =====================================================================
// Devis
// =====================================================================

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

  // Projets client candidats : tous ceux qui n'ont pas déjà une invoice
  // kind='quote' avec dougs_quote_id.
  const allClientProjects = await conn
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
    .where(eq(projects.kind, "client"));

  const linkedQuoteRows = await conn
    .select({ dougsQuoteId: invoices.dougsQuoteId, projectId: invoices.projectId })
    .from(invoices)
    .where(eq(invoices.kind, "quote"));
  const linkedQuoteIds = new Set(
    linkedQuoteRows.map((r) => r.dougsQuoteId).filter((x): x is string => !!x),
  );
  const projectsWithQuote = new Set(
    linkedQuoteRows.map((r) => r.projectId).filter((x): x is string => !!x),
  );
  const candidates = allClientProjects.filter((p) => !projectsWithQuote.has(p.id));

  // Fetch devis Dougs, exclut ceux déjà liés.
  const dougsQuotes = await listDougsQuotes(userId, { limit: 200 });
  const unlinkedQuotesList = dougsQuotes.filter((q) => !linkedQuoteIds.has(q.id));

  // Enrichissement avec détail.
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

  const out: QuoteSuggestion[] = [];
  for (const q of enrichedQuotes) {
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

  out.sort((a, b) => (b.candidates[0]?.score.total ?? 0) - (a.candidates[0]?.score.total ?? 0));
  return out;
}

// =====================================================================
// Factures (sales-invoice) + avoirs
// =====================================================================

export type InvoiceCandidate =
  | {
      kind: "invoice";
      /** Invoice Paradeos id (peut être un jalon, coworking, one_off). */
      invoiceId: string;
      label: string;
      projectName: string | null;
      contractName: string | null;
      entityName: string | null;
      amountHt: number;
      score: MatchScore;
    }
  | {
      // Pas d'invoice existante → propose d'en créer une à la volée
      // pour un projet client (acompte/intermediaire/solde détecté).
      kind: "new_project_milestone";
      projectId: string;
      projectName: string;
      entityName: string | null;
      projectValueHt: number;
      detectedPercent: number | null;
      amountHt: number;
      score: MatchScore;
    }
  | {
      // Pas d'invoice existante → propose d'en créer une à la volée
      // pour un contrat coworking.
      kind: "new_coworking_invoice";
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
  link: {
    cancelsDougsInvoiceId: string;
    invoice: { reference: string | null; clientName: string; totalHt: number | null } | null;
  } | null;
};

export type InvoiceSuggestionsResult = {
  invoices: InvoiceSuggestion[];
  creditNotes: CreditNoteEntry[];
  invoiceOptions: DougsInvoiceOption[];
};

export async function getInvoiceSuggestions(
  userId: string,
  opts: { debug?: boolean } = {},
): Promise<InvoiceSuggestionsResult> {
  const conn = await db();

  // 1. Tous les invoices Paradeos qui peuvent être candidats (kind ∈
  // {milestone, coworking, one_off}) ET sans dougs_invoice_id.
  const unlinkedInvoiceCandidates = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      label: invoices.label,
      amountHt: invoices.amountHt,
      projectId: invoices.projectId,
      coworkingContractId: invoices.coworkingContractId,
      milestonePercent: invoices.milestonePercent,
      periodStart: invoices.periodStart,
      periodEnd: invoices.periodEnd,
      createdAt: invoices.createdAt,
      projectName: projects.name,
      projectEntityName: entities.name,
      contractName: coworkingContracts.name,
      contractContactId: coworkingContracts.contactId,
      contractEntityName: entities.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(
      entities,
      // Si project_id, prend project.entityId ; sinon, contract.billToEntityId.
      eq(
        entities.id,
        // drizzle: COALESCE n'est pas trivial ici, on join 2x serait
        // plus propre. Compromis : join sur projects.entityId, et on
        // récupère contractEntity via une sous-requête manuelle plus bas.
        projects.entityId,
      ),
    )
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .where(
      and(
        isNull(invoices.dougsInvoiceId),
        // exclude kind quote et credit_note (gérés à part)
        // drizzle ne fait pas in/notIn directement ici, on filtre côté JS
      ),
    );

  // Filtre côté JS pour kind ∈ {milestone, coworking, one_off}.
  const candidatesData = unlinkedInvoiceCandidates.filter(
    (c) => c.kind === "milestone" || c.kind === "coworking" || c.kind === "one_off",
  );

  // Pour les coworking, on a besoin de l'entité de facturation (billToEntity)
  // qui n'a pas été ramenée par le join (la colonne entities ci-dessus
  // est sur projects.entityId). On fait un second batch.
  const cwContractIds = candidatesData
    .filter((c) => c.kind === "coworking" && c.coworkingContractId)
    .map((c) => c.coworkingContractId as string);
  const cwBillingMap = new Map<string, string | null>();
  if (cwContractIds.length > 0) {
    const cwBilling = await conn
      .select({
        contractId: coworkingContracts.id,
        billToEntityName: entities.name,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(coworkingContracts)
      .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
      .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId));
    for (const r of cwBilling) {
      const fromContact = `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim();
      cwBillingMap.set(r.contractId, r.billToEntityName ?? (fromContact || null));
    }
  }

  // 2. Liste Dougs et split factures / avoirs.
  const dougsInvoicesAll = await listDougsSalesInvoices(userId, { limit: 200 });
  const dougsInvoicesNormal: typeof dougsInvoicesAll = [];
  const dougsCreditNotes: typeof dougsInvoicesAll = [];
  for (const i of dougsInvoicesAll) {
    const ht = pickHt(i);
    const ttc = pickTtc(i);
    const isCredit =
      i.isRefund === true ||
      (typeof ht === "number" && ht < 0) ||
      (typeof ttc === "number" && ttc < 0);
    if (isCredit) dougsCreditNotes.push(i);
    else dougsInvoicesNormal.push(i);
  }

  // Liens déjà actifs (invoices.dougs_invoice_id non null).
  const linkedRows = await conn.select({ dougsInvoiceId: invoices.dougsInvoiceId }).from(invoices);
  const linkedDougsIds = new Set(
    linkedRows.map((r) => r.dougsInvoiceId).filter((x): x is string => !!x),
  );
  const unlinkedDougsList = dougsInvoicesNormal.filter((i) => !linkedDougsIds.has(i.id));

  // Enrichissement (le list endpoint n'envoie pas clientData complet).
  const unlinkedDougsInvoices: (DougsSalesInvoice & { id: string })[] = await pMap(
    unlinkedDougsList.slice(0, 50),
    async (i) => {
      try {
        const detail = await getDougsSalesInvoice(userId, i.id);
        return { ...i, ...detail, id: i.id } as DougsSalesInvoice & { id: string };
      } catch (err) {
        console.warn(
          `[rapprochement] enrich invoice ${i.id} failed:`,
          err instanceof Error ? err.message : err,
        );
        return { ...i, id: i.id } as DougsSalesInvoice & { id: string };
      }
    },
    5,
  );

  // 3. Projets clients (pour candidat "new_project_milestone").
  const allClientProjects = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      startDate: projects.startDate,
      createdAt: projects.createdAt,
      valueAmount: projects.valueAmount,
      budgetAmount: projects.budgetAmount,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.kind, "client"));

  // 4. Contrats coworking (pour candidat "new_coworking_invoice").
  const allCoworkingContracts = await conn
    .select({
      id: coworkingContracts.id,
      name: coworkingContracts.name,
      desks: coworkingContracts.desks,
      unitPriceHt: coworkingContracts.unitPriceHt,
      startDate: coworkingContracts.startDate,
      billingFrequency: coworkingContracts.billingFrequency,
      status: coworkingContracts.status,
      billToEntityName: entities.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
    })
    .from(coworkingContracts)
    .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId));

  // 5. Pour chaque facture Dougs non liée, score contre les candidats.
  const out: InvoiceSuggestion[] = [];
  for (const inv of unlinkedDougsInvoices) {
    const dougsAmount = pickHt(inv) ?? pickTtc(inv);
    const dougsClientName = pickDougsClientName(inv);

    // 5a. Candidats : invoices Paradeos existantes (kind ∈
    //     {milestone, coworking, one_off}) sans lien Dougs.
    const existingScored: Array<Extract<InvoiceCandidate, { kind: "invoice" }>> = [];
    for (const c of candidatesData) {
      const amountHt = Number(c.amountHt) || 0;
      const clientName =
        c.kind === "coworking"
          ? (cwBillingMap.get(c.coworkingContractId ?? "") ?? null)
          : c.projectEntityName;
      const label =
        c.kind === "milestone"
          ? `${c.projectName ?? "?"} — ${c.label}`
          : c.kind === "coworking"
            ? `${c.contractName ?? "?"} — ${c.label}`
            : c.label;
      const score = scoreMatch(
        {
          legalName: dougsClientName,
          firstName: inv.clientData?.firstName ?? null,
          lastName: inv.clientData?.lastName ?? null,
          amount: dougsAmount,
          createdAt: inv.createdAt ?? null,
        },
        {
          clientName,
          amount: amountHt,
          date: c.periodStart ?? c.createdAt,
        },
      );
      if (score.total < 0.3) continue;
      existingScored.push({
        kind: "invoice",
        invoiceId: c.id,
        label,
        projectName: c.projectName ?? null,
        contractName: c.contractName ?? null,
        entityName: clientName,
        amountHt,
        score,
      });
    }

    // 5b. "Nouveau jalon projet" : projet client avec un % standard
    //     (acompte/solde) matchant l'amount Dougs.
    const newProjectScored: InvoiceCandidate[] = [];
    if (typeof dougsAmount === "number" && dougsAmount > 0) {
      // Skip projets qui ont déjà un candidat invoice existante.
      const projectIdsWithCandidate = new Set(
        existingScored
          .map((s) => {
            const m = candidatesData.find((c) => c.id === s.invoiceId);
            return m?.projectId ?? null;
          })
          .filter((x): x is string => !!x),
      );
      for (const p of allClientProjects) {
        if (projectIdsWithCandidate.has(p.id)) continue;
        const projectValueHt = Number(p.valueAmount ?? p.budgetAmount ?? 0);
        if (projectValueHt <= 0) continue;
        const nameSim = similarityName(dougsClientName, p.entityName);
        const partial = similarityAmountPartial(dougsAmount, projectValueHt);
        const dateSim = similarityDate(inv.createdAt ?? null, p.startDate ?? p.createdAt);
        const total =
          Math.round((nameSim * 0.5 + partial.score * 0.3 + dateSim * 0.2) * 1000) / 1000;
        if (total < 0.3) continue;
        newProjectScored.push({
          kind: "new_project_milestone",
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

    // 5c. "Nouveau coworking" : contrat coworking sans facture Paradeos
    //     pour la période, si le total mensuel × N mois colle à l'amount.
    const newCoworkingScored: InvoiceCandidate[] = [];
    if (typeof dougsAmount === "number" && dougsAmount > 0) {
      // Skip contrats qui ont déjà un candidat invoice existante.
      const contractIdsWithCandidate = new Set(
        existingScored
          .map((s) => {
            const m = candidatesData.find((c) => c.id === s.invoiceId);
            return m?.coworkingContractId ?? null;
          })
          .filter((x): x is string => !!x),
      );
      for (const ct of allCoworkingContracts) {
        if (ct.status === "termine") continue;
        if (contractIdsWithCandidate.has(ct.id)) continue;
        const monthlyHt = Number(ct.unitPriceHt) * ct.desks;
        if (monthlyHt <= 0) continue;
        // Deux ratios standards : 1 mois ou 3 mois (mensuel / trimestriel).
        const expectedMonthly = monthlyHt;
        const expectedQuarterly = monthlyHt * 3;
        const closer =
          Math.abs(dougsAmount - expectedMonthly) <= Math.abs(dougsAmount - expectedQuarterly)
            ? expectedMonthly
            : expectedQuarterly;
        const amountSim = similarityAmountPartial(dougsAmount, closer).score;
        const fromContact = `${ct.contactFirstName ?? ""} ${ct.contactLastName ?? ""}`.trim();
        const nameSim = similarityName(
          dougsClientName,
          ct.billToEntityName ?? (fromContact || null),
        );
        const dateSim = similarityDate(inv.createdAt ?? null, ct.startDate);
        const total = Math.round((nameSim * 0.5 + amountSim * 0.3 + dateSim * 0.2) * 1000) / 1000;
        if (total < 0.3) continue;
        newCoworkingScored.push({
          kind: "new_coworking_invoice",
          contractId: ct.id,
          contractName: ct.name,
          entityName: ct.billToEntityName ?? (fromContact || null),
          monthlyHt,
          desks: ct.desks,
          amountHt: dougsAmount,
          score: { total, name: nameSim, amount: amountSim, date: dateSim },
        });
      }
    }

    const all = [...existingScored, ...newProjectScored, ...newCoworkingScored]
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 4);

    out.push({
      dougs: {
        id: inv.id,
        reference: inv.reference ?? null,
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

  // 6. Avoirs : enrichissement + résolution du lien Paradeos.
  // L'avoir est une invoice kind='credit_note' avec dougs_invoice_id=
  // creditNoteId et cancels_invoice_id pointant vers l'invoice annulée.
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

  // Pour résoudre le lien : pour chaque avoir, trouver l'invoice
  // credit_note correspondante par dougs_invoice_id, puis suivre
  // cancels_invoice_id vers l'invoice annulée et lire son dougs_invoice_id.
  const creditNoteDougsIds = enrichedCreditNotes.map((cn) => cn.id);
  const creditNoteRows =
    creditNoteDougsIds.length > 0
      ? await conn
          .select({
            id: invoices.id,
            dougsInvoiceId: invoices.dougsInvoiceId,
            cancelsInvoiceId: invoices.cancelsInvoiceId,
            cancelsDougsInvoiceId: invoices.cancelsDougsInvoiceId,
          })
          .from(invoices)
          .where(eq(invoices.kind, "credit_note"))
      : [];
  const creditNoteRowByDougsId = new Map(
    creditNoteRows
      .filter((r) => r.dougsInvoiceId && creditNoteDougsIds.includes(r.dougsInvoiceId))
      .map((r) => [r.dougsInvoiceId as string, r]),
  );

  // Détails de la facture annulée (côté Paradeos, optionnel) si on a
  // cancels_invoice_id. Permet d'afficher le label/montant en plus de
  // la référence Dougs.
  const cancelledInvoiceIds = Array.from(creditNoteRowByDougsId.values())
    .map((r) => r.cancelsInvoiceId)
    .filter((x): x is string => !!x);
  const cancelledInvoiceRows =
    cancelledInvoiceIds.length > 0
      ? await conn
          .select({
            id: invoices.id,
            label: invoices.label,
            amountHt: invoices.amountHt,
            dougsReference: invoices.dougsReference,
          })
          .from(invoices)
      : [];
  const cancelledById = new Map(
    cancelledInvoiceRows.filter((r) => cancelledInvoiceIds.includes(r.id)).map((r) => [r.id, r]),
  );

  // Index aussi les factures Dougs (du run en cours) par leur ID pour
  // pouvoir afficher la référence / nom client à partir du seul Dougs ID.
  const dougsInvoicesById = new Map(dougsInvoicesNormal.map((i) => [i.id, i]));

  const creditNotes: CreditNoteEntry[] = enrichedCreditNotes.map((cn) => {
    const row = creditNoteRowByDougsId.get(cn.id);
    const cancelledLocal = row?.cancelsInvoiceId ? cancelledById.get(row.cancelsInvoiceId) : null;
    const dougsCancelled = row?.cancelsDougsInvoiceId
      ? dougsInvoicesById.get(row.cancelsDougsInvoiceId)
      : null;
    return {
      dougs: {
        id: cn.id,
        reference: cn.reference ?? null,
        status: cn.status ?? (cn as { paymentStatus?: string }).paymentStatus ?? null,
        totalHt: negate(pickHt(cn)),
        totalTtc: negate(pickTtc(cn)),
        clientName: pickDougsClientName(cn) ?? "—",
        createdAt: cn.createdAt ?? null,
      },
      link: row?.cancelsDougsInvoiceId
        ? {
            cancelsDougsInvoiceId: row.cancelsDougsInvoiceId,
            invoice: cancelledLocal
              ? {
                  reference: cancelledLocal.dougsReference ?? null,
                  clientName: cancelledLocal.label,
                  totalHt: Number(cancelledLocal.amountHt) || null,
                }
              : dougsCancelled
                ? {
                    reference: dougsCancelled.reference ?? null,
                    clientName: pickDougsClientName(dougsCancelled) ?? "—",
                    totalHt: pickHt(dougsCancelled),
                  }
                : null,
          }
        : null,
    };
  });

  const invoiceOptions: DougsInvoiceOption[] = dougsInvoicesNormal
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

// =====================================================================
// Liens déjà actifs (pour la section "Déjà rattachés")
// =====================================================================

export type LinkedDougsEntries = {
  quotes: {
    invoiceId: string;
    dougsId: string;
    reference: string | null;
    status: string | null;
    projectId: string;
    projectName: string;
    entityName: string | null;
  }[];
  invoices: {
    invoiceId: string;
    dougsId: string;
    reference: string | null;
    kind: "milestone" | "coworking" | "one_off";
    label: string;
    amountHt: number;
    status: "draft" | "sent" | "accepted" | "refused" | "paid";
    projectId: string | null;
    projectName: string | null;
    coworkingContractId: string | null;
    contractName: string | null;
    entityName: string | null;
  }[];
  /** Invoices disponibles comme cible de relink (sans dougs_invoice_id /
   *  dougs_quote_id selon le kind). */
  freeInvoices: {
    id: string;
    kind: "milestone" | "coworking" | "one_off";
    label: string;
    amountHt: number;
    projectName: string | null;
    contractName: string | null;
  }[];
  freeQuoteProjects: { id: string; name: string; entityName: string | null }[];
};

export async function getLinkedDougsEntries(): Promise<LinkedDougsEntries> {
  const conn = await db();

  const rows = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      label: invoices.label,
      amountHt: invoices.amountHt,
      status: invoices.status,
      projectId: invoices.projectId,
      coworkingContractId: invoices.coworkingContractId,
      dougsInvoiceId: invoices.dougsInvoiceId,
      dougsQuoteId: invoices.dougsQuoteId,
      dougsReference: invoices.dougsReference,
      dougsStatus: invoices.dougsStatus,
      projectName: projects.name,
      projectEntityName: entities.name,
      contractName: coworkingContracts.name,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId));

  const quotes: LinkedDougsEntries["quotes"] = [];
  const linkedInvoices: LinkedDougsEntries["invoices"] = [];
  const freeInvoices: LinkedDougsEntries["freeInvoices"] = [];

  for (const r of rows) {
    if (r.kind === "quote") {
      if (r.dougsQuoteId && r.projectId) {
        quotes.push({
          invoiceId: r.id,
          dougsId: r.dougsQuoteId,
          reference: r.dougsReference,
          status: r.dougsStatus,
          projectId: r.projectId,
          projectName: r.projectName ?? "?",
          entityName: r.projectEntityName,
        });
      }
    } else if (r.kind === "milestone" || r.kind === "coworking" || r.kind === "one_off") {
      if (r.dougsInvoiceId) {
        linkedInvoices.push({
          invoiceId: r.id,
          dougsId: r.dougsInvoiceId,
          reference: r.dougsReference,
          kind: r.kind,
          label: r.label,
          amountHt: Number(r.amountHt) || 0,
          status: r.status as "draft" | "sent" | "accepted" | "refused" | "paid",
          projectId: r.projectId,
          projectName: r.projectName,
          coworkingContractId: r.coworkingContractId,
          contractName: r.contractName,
          entityName: r.projectEntityName,
        });
      } else {
        freeInvoices.push({
          id: r.id,
          kind: r.kind,
          label: r.label,
          amountHt: Number(r.amountHt) || 0,
          projectName: r.projectName,
          contractName: r.contractName,
        });
      }
    }
  }

  // Projets clients sans quote invoice (pour relink quote).
  const projectsWithQuote = new Set(quotes.map((q) => q.projectId).filter((x): x is string => !!x));
  const allClientProjects = await conn
    .select({
      id: projects.id,
      name: projects.name,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.kind, "client"));
  const freeQuoteProjects = allClientProjects.filter((p) => !projectsWithQuote.has(p.id));

  return { quotes, invoices: linkedInvoices, freeInvoices, freeQuoteProjects };
}

// Re-export utilitaires pour les callers qui veulent normaliser eux-mêmes.
export { monthsBetween };
