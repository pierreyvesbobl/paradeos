import "server-only";

import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import {
  cachedGetDougsQuote,
  cachedGetDougsSalesInvoice,
  cachedListDougsQuotes,
  cachedListDougsSalesInvoices,
} from "@/lib/dougs/cache";
import { type DougsQuote, type DougsSalesInvoice, pickDougsClientName } from "@/lib/dougs/client";
import {
  type CreditNoteLink,
  type ExistingInvoiceCandidate,
  INVOICE_CANDIDATES_LIMIT,
  type InvoiceCandidate,
  type LinkedDougsEntries,
  type QuoteCandidate,
  classifyLinkedInvoiceRows,
  dougsName,
  dougsSideOf,
  isDougsCreditNote,
  isMatchableInvoiceCandidate,
  negate,
  pMap,
  pickHt,
  pickTtc,
  rankCandidates,
  resolveCreditNoteLink,
  scoreExistingInvoiceCandidate,
  scoreNewProjectMilestoneCandidate,
  scoreQuoteProjectCandidates,
  sortByBestCandidate,
  sortByCreatedAtDesc,
} from "@/lib/dougs/reconciliation-rules";
import { personNameOrNull } from "@/lib/format";
import { monthsBetween } from "@/lib/schemas/coworking";
import { and, eq, isNull } from "drizzle-orm";

// Les types de résultat vivent dans reconciliation-rules.ts (module pur) ;
// on les ré-exporte pour les callers (vue rapprochement, inbox).
export type { InvoiceCandidate, LinkedDougsEntries };

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
  candidates: QuoteCandidate[];
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
  const dougsQuotes = await cachedListDougsQuotes(userId, { limit: 200 });
  const unlinkedQuotesList = dougsQuotes.filter((q) => !linkedQuoteIds.has(q.id));

  // Enrichissement avec détail.
  const enrichedQuotes: (DougsQuote & { id: string })[] = await pMap(
    unlinkedQuotesList.slice(0, 50),
    async (q) => {
      try {
        const detail = await cachedGetDougsQuote(userId, q.id);
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
    const scored = scoreQuoteProjectCandidates(dougsSideOf(q), candidates);

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

  return sortByBestCandidate(out);
}

// =====================================================================
// Factures (sales-invoice) + avoirs
// =====================================================================

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
  link: CreditNoteLink;
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
      billedBy: invoices.billedBy,
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
    .where(
      and(
        isNull(invoices.dougsInvoiceId),
        // exclude kind quote et credit_note (gérés à part)
        // drizzle ne fait pas in/notIn directement ici, on filtre côté JS
      ),
    );

  // Filtre côté JS pour kind ∈ {milestone, coworking, one_off}. Exclut
  // aussi les factures coworking facturées par G&O (billedBy='g_and_o')
  // qui ne doivent ni remonter dans le matching ni dans les KPIs.
  const candidatesData = unlinkedInvoiceCandidates.filter(isMatchableInvoiceCandidate);

  // Pour les coworking, on collecte toutes les identités possibles du
  // "client" (billToEntity, entité rattachée au contact, contact lui-même,
  // contrat lui-même). Dougs peut avoir facturé n'importe laquelle de ces
  // identités selon la config (ex : contrat billTo="Acme SAS" mais Dougs
  // facture "Alice Martin", ou l'inverse). Le scoring plus bas prend le
  // max de similarité sur cette liste → beaucoup moins de faux 0.
  const cwContractIds = candidatesData
    .filter((c) => c.kind === "coworking" && c.coworkingContractId)
    .map((c) => c.coworkingContractId as string);
  const cwCandidatesMap = new Map<string, string[]>();
  const cwPrimaryNameMap = new Map<string, string | null>();
  if (cwContractIds.length > 0) {
    // 1er join : billToEntity + contact du contrat.
    const cwBilling = await conn
      .select({
        contractId: coworkingContracts.id,
        contractName: coworkingContracts.name,
        contactId: coworkingContracts.contactId,
        billToEntityName: entities.name,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(coworkingContracts)
      .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
      .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId));
    // 2e join : entité employeur du contact (contact.entityId → entities).
    // Souvent renseigné quand le contrat n'a pas de billToEntity mais que
    // Dougs facture l'entreprise du contact.
    const contactIds = Array.from(
      new Set(cwBilling.map((r) => r.contactId).filter((x): x is string => !!x)),
    );
    const contactEntityMap = new Map<string, string | null>();
    if (contactIds.length > 0) {
      const rows = await conn
        .select({
          contactId: contacts.id,
          entityName: entities.name,
        })
        .from(contacts)
        .leftJoin(entities, eq(entities.id, contacts.entityId));
      for (const r of rows) contactEntityMap.set(r.contactId, r.entityName ?? null);
    }
    for (const r of cwBilling) {
      const fromContact = personNameOrNull(r.contactFirstName, r.contactLastName);
      const contactEntity = r.contactId ? (contactEntityMap.get(r.contactId) ?? null) : null;
      const names = [r.billToEntityName, contactEntity, fromContact, r.contractName].filter(
        (x): x is string => !!x,
      );
      cwCandidatesMap.set(r.contractId, names);
      // Nom "canonique" affiché dans le picker (priorité : entité de
      // facturation > entité du contact > personne > contrat).
      cwPrimaryNameMap.set(r.contractId, names[0] ?? null);
    }
  }

  // 2. Liste Dougs et split factures / avoirs.
  const dougsInvoicesAll = await cachedListDougsSalesInvoices(userId, { limit: 200 });
  const dougsInvoicesNormal: typeof dougsInvoicesAll = [];
  const dougsCreditNotes: typeof dougsInvoicesAll = [];
  for (const i of dougsInvoicesAll) {
    if (isDougsCreditNote(i)) dougsCreditNotes.push(i);
    else dougsInvoicesNormal.push(i);
  }

  // Liens déjà actifs (invoices.dougs_invoice_id non null).
  const linkedRows = await conn.select({ dougsInvoiceId: invoices.dougsInvoiceId }).from(invoices);
  const linkedDougsIds = new Set(
    linkedRows.map((r) => r.dougsInvoiceId).filter((x): x is string => !!x),
  );

  // Factures Dougs annulées par un avoir : on les exclut du flux de
  // matching pour qu'elles n'apparaissent plus comme candidates. Sans
  // ça, après linkDougsCreditNote la facture annulée revenait dans la
  // liste "non liées" puisque son lien Paradeos avait été cleared par
  // le cascade. (cf. cancels_dougs_invoice_id sur les credit_notes).
  const cancelledDougsIdsRows = await conn
    .select({ cancelsDougsInvoiceId: invoices.cancelsDougsInvoiceId })
    .from(invoices)
    .where(eq(invoices.kind, "credit_note"));
  const cancelledDougsIds = new Set(
    cancelledDougsIdsRows.map((r) => r.cancelsDougsInvoiceId).filter((x): x is string => !!x),
  );

  const unlinkedDougsList = dougsInvoicesNormal.filter(
    (i) => !linkedDougsIds.has(i.id) && !cancelledDougsIds.has(i.id),
  );

  // Enrichissement (le list endpoint n'envoie pas clientData complet).
  const unlinkedDougsInvoices: (DougsSalesInvoice & { id: string })[] = await pMap(
    unlinkedDougsList.slice(0, 50),
    async (i) => {
      try {
        const detail = await cachedGetDougsSalesInvoice(userId, i.id);
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

  // 4. Pour chaque facture Dougs non liée, score contre les candidats.
  const out: InvoiceSuggestion[] = [];
  for (const inv of unlinkedDougsInvoices) {
    const dougsSide = dougsSideOf(inv);

    // 5a. Candidats : invoices Paradeos existantes (kind ∈
    //     {milestone, coworking, one_off}) sans lien Dougs.
    //
    // Scoring unifié : chaque candidat expose N noms de client possibles
    // (billToEntity, entité employeur du contact, contact lui-même,
    // contrat/projet). On score contre chacun et on garde le max total.
    // Ça règle le cas classique où Dougs facture "Alice Martin" mais le
    // contrat coworking a billToEntity="Acme SAS" (ou l'inverse) → sans
    // ça, similarityName renvoie 0 et le candidat est écarté.
    const existingScored: ExistingInvoiceCandidate[] = [];
    for (const c of candidatesData) {
      const clientNames: string[] =
        c.kind === "coworking"
          ? (cwCandidatesMap.get(c.coworkingContractId ?? "") ?? [])
          : ([c.projectEntityName, c.projectName].filter((x): x is string => !!x) as string[]);
      const primaryName =
        c.kind === "coworking"
          ? (cwPrimaryNameMap.get(c.coworkingContractId ?? "") ?? null)
          : (c.projectEntityName ?? null);
      const candidate = scoreExistingInvoiceCandidate(dougsSide, c, clientNames, primaryName);
      if (candidate) existingScored.push(candidate);
    }

    // 5b. "Nouveau jalon projet" : projet client avec un % standard
    //     (acompte/solde) matchant l'amount Dougs.
    const newProjectScored: InvoiceCandidate[] = [];
    const dougsAmount = dougsSide.amount;
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
        const candidate = scoreNewProjectMilestoneCandidate(
          { clientName: dougsSide.legalName, amount: dougsAmount, createdAt: dougsSide.createdAt },
          p,
        );
        if (candidate) newProjectScored.push(candidate);
      }
    }

    const all = rankCandidates([...existingScored, ...newProjectScored], INVOICE_CANDIDATES_LIMIT);

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

  const sortedOut = sortByBestCandidate(out);

  // 6. Avoirs : enrichissement + résolution du lien Paradeos.
  // L'avoir est une invoice kind='credit_note' avec dougs_invoice_id=
  // creditNoteId et cancels_invoice_id pointant vers l'invoice annulée.
  const enrichedCreditNotes: (DougsSalesInvoice & { id: string })[] = await pMap(
    dougsCreditNotes,
    async (i) => {
      try {
        const detail = await cachedGetDougsSalesInvoice(userId, i.id);
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
      link: resolveCreditNoteLink(row, cancelledLocal, dougsCancelled),
    };
  });

  const invoiceOptions: DougsInvoiceOption[] = sortByCreatedAtDesc(
    dougsInvoicesNormal
      .filter((i) => !cancelledDougsIds.has(i.id))
      .map((i) => ({
        id: i.id,
        reference: i.reference ?? null,
        clientName: pickDougsClientName(i) ?? "—",
        totalHt: pickHt(i),
        createdAt: i.createdAt ?? null,
      })),
  );

  return { invoices: sortedOut, creditNotes, invoiceOptions };
}

// =====================================================================
// Liens déjà actifs (pour la section "Déjà rattachés")
// =====================================================================

export async function getLinkedDougsEntries(): Promise<LinkedDougsEntries> {
  const conn = await db();

  const rows = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      label: invoices.label,
      amountHt: invoices.amountHt,
      status: invoices.status,
      billedBy: invoices.billedBy,
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

  const { quotes, invoices: linkedInvoices, freeInvoices } = classifyLinkedInvoiceRows(rows);

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
