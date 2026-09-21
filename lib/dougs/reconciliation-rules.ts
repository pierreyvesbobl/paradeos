import { pickDougsClientName } from "@/lib/dougs/client";
import {
  type MatchScore,
  NAME_MATCH_FLOOR,
  scoreMatch,
  scoreMatchBest,
  similarityAmountPartial,
  similarityDate,
  similarityName,
} from "@/lib/dougs/match";

/**
 * Règles pures du rapprochement Dougs ↔ Paradeos. Ce module ne touche ni
 * à la base ni à l'API Dougs : `reconciliation.ts` fait la plomberie
 * (requêtes, enrichissement) et délègue ici chaque décision, ce qui
 * permet de tester le comportement métier sans infrastructure.
 */

/** Score minimal pour qu'un candidat soit proposé à l'utilisateur. */
export const PROPOSAL_THRESHOLD = 0.3;

/** Nombre max de candidats projet proposés pour un devis Dougs. */
export const QUOTE_CANDIDATES_LIMIT = 3;

/** Nombre max de candidats proposés pour une facture Dougs. */
export const INVOICE_CANDIDATES_LIMIT = 4;

// =====================================================================
// Utilitaires
// =====================================================================

/**
 * Map async avec concurrency cap. Évite de saturer Dougs (Cloudflare
 * rate-limit) avec un Promise.all de 50 GET d'un coup.
 *
 * Ré-exporté depuis `lib/async/p-map` : l'utilitaire sert aussi au
 * backfill Drive, qui n'a rien à voir avec Dougs.
 */
export { pMap } from "@/lib/async/p-map";

export type DougsClientData = {
  legalName?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/** Nom client affiché pour une entrée Dougs, « — » si rien d'exploitable. */
export function dougsName(c: DougsClientData | null | undefined, fallback?: string | null): string {
  const fromObj = c?.legalName ?? c?.name ?? `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  const v = fromObj || fallback || "";
  return v || "—";
}

export type DougsAmounts = {
  totalNetAmount?: number | null;
  netAmount?: unknown;
  totalAmountWithVat?: number | null;
  amount?: unknown;
};

export function pickHt(o: DougsAmounts): number | null {
  if (typeof o.totalNetAmount === "number") return o.totalNetAmount;
  if (typeof o.netAmount === "number") return o.netAmount;
  return null;
}

export function pickTtc(o: DougsAmounts): number | null {
  if (typeof o.totalAmountWithVat === "number") return o.totalAmountWithVat;
  if (typeof o.amount === "number") return o.amount;
  return null;
}

/** Force un montant en négatif (affichage des avoirs). 0 reste 0, jamais -0. */
export function negate(n: number | null): number | null {
  if (n === null) return null;
  return n === 0 ? 0 : -Math.abs(n);
}

/**
 * Un avoir Dougs se reconnaît d'abord par `isRefund` : /sales-invoices
 * mêle factures et avoirs et le montant d'un avoir peut rester positif.
 * Un montant négatif reste accepté comme signal de secours.
 */
export function isDougsCreditNote(i: DougsAmounts & { isRefund?: boolean | null }): boolean {
  const ht = pickHt(i);
  const ttc = pickTtc(i);
  return (
    i.isRefund === true ||
    (typeof ht === "number" && ht < 0) ||
    (typeof ttc === "number" && ttc < 0)
  );
}

/** Montant Dougs de référence pour le matching : HT, sinon TTC. */
export function dougsMatchAmount(o: DougsAmounts): number | null {
  return pickHt(o) ?? pickTtc(o);
}

/** Côté Dougs d'un score : identité + montant + date. */
export type DougsSide = {
  legalName: string | null;
  firstName: string | null;
  lastName: string | null;
  amount: number | null;
  createdAt: string | null;
};

export function dougsSideOf(
  o: DougsAmounts & Parameters<typeof pickDougsClientName>[0] & { createdAt?: string | null },
): DougsSide {
  return {
    legalName: pickDougsClientName(o),
    firstName: o.clientData?.firstName ?? null,
    lastName: o.clientData?.lastName ?? null,
    amount: dougsMatchAmount(o),
    createdAt: o.createdAt ?? null,
  };
}

/** Tri décroissant par date de création (null en dernier). Copie. */
export function sortByCreatedAtDesc<T extends { createdAt: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da;
  });
}

/** Tri décroissant par score, puis coupe à `limit`. Copie. */
export function rankCandidates<T extends { score: MatchScore }>(items: T[], limit: number): T[] {
  return [...items].sort((a, b) => b.score.total - a.score.total).slice(0, limit);
}

/**
 * Trie les suggestions pour afficher d'abord celles dont le meilleur
 * candidat est le plus sûr. Une suggestion sans candidat vaut 0.
 */
export function sortByBestCandidate<T extends { candidates: { score: MatchScore }[] }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => (b.candidates[0]?.score.total ?? 0) - (a.candidates[0]?.score.total ?? 0),
  );
}

// =====================================================================
// Devis
// =====================================================================

export type QuoteProjectCandidate = {
  id: string;
  name: string;
  entityName: string | null;
  valueAmount: string | number | null;
  budgetAmount: string | number | null;
  startDate: string | null;
  createdAt: Date | string | null;
};

export type QuoteCandidate = {
  projectId: string;
  projectName: string;
  entityName: string | null;
  valueAmount: number | null;
  score: MatchScore;
};

/** Montant de référence d'un projet : valeur, sinon budget, sinon null. */
export function projectReferenceAmount(p: {
  valueAmount: string | number | null;
  budgetAmount: string | number | null;
}): number | null {
  // Un montant à 0 vaut « non renseigné » : on retombe sur le budget.
  return Number(p.valueAmount) || Number(p.budgetAmount) || null;
}

/**
 * Score un devis Dougs contre les projets clients sans devis. Garde les
 * candidats au-dessus du seuil, les meilleurs d'abord, 3 max.
 */
export function scoreQuoteProjectCandidates(
  dougs: DougsSide,
  candidates: QuoteProjectCandidate[],
): QuoteCandidate[] {
  const scored = candidates.map((c) => {
    const paradeosAmount = projectReferenceAmount(c);
    const score = scoreMatch(dougs, {
      clientName: c.entityName,
      amount: paradeosAmount,
      date: c.startDate ?? c.createdAt,
    });
    return {
      projectId: c.id,
      projectName: c.name,
      entityName: c.entityName,
      valueAmount: paradeosAmount,
      score,
    };
  });
  return rankCandidates(
    scored.filter((x) => x.score.total >= PROPOSAL_THRESHOLD),
    QUOTE_CANDIDATES_LIMIT,
  );
}

// =====================================================================
// Factures
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
    };

export type ExistingInvoiceCandidate = Extract<InvoiceCandidate, { kind: "invoice" }>;
export type NewProjectMilestoneCandidate = Extract<
  InvoiceCandidate,
  { kind: "new_project_milestone" }
>;

/**
 * Une invoice Paradeos est candidate au rapprochement si elle est d'un
 * kind facturable (jalon, coworking, ponctuel) et si elle n'est pas
 * facturée par G&O (ces factures ne remontent ni dans le matching ni
 * dans les KPIs).
 */
export function isMatchableInvoiceCandidate<T extends { kind: string; billedBy: string | null }>(
  c: T,
): c is T & { kind: "milestone" | "coworking" | "one_off" } {
  if (c.kind !== "milestone" && c.kind !== "coworking" && c.kind !== "one_off") return false;
  if (c.kind === "coworking" && c.billedBy === "g_and_o") return false;
  return true;
}

/** Libellé d'un candidat : « Projet — jalon », « Contrat — période » ou brut. */
export function invoiceCandidateLabel(c: {
  kind: string;
  label: string;
  projectName: string | null;
  contractName: string | null;
}): string {
  if (c.kind === "milestone") return `${c.projectName ?? "?"} — ${c.label}`;
  if (c.kind === "coworking") return `${c.contractName ?? "?"} — ${c.label}`;
  return c.label;
}

export type ExistingInvoiceInput = {
  id: string;
  kind: string;
  label: string;
  amountHt: string | number | null;
  projectName: string | null;
  contractName: string | null;
  periodStart: string | null;
  createdAt: Date | string | null;
};

/**
 * Score une facture Dougs contre une invoice Paradeos existante. Chaque
 * candidat expose N noms de client possibles (billToEntity, entité
 * employeur du contact, contact lui-même, contrat/projet) ; on garde le
 * meilleur. Null si sous le seuil.
 */
export function scoreExistingInvoiceCandidate(
  dougs: DougsSide,
  c: ExistingInvoiceInput,
  clientNames: string[],
  primaryName: string | null,
): ExistingInvoiceCandidate | null {
  const amountHt = Number(c.amountHt) || 0;
  const bestScore = scoreMatchBest(dougs, clientNames, {
    amount: amountHt,
    date: c.periodStart ?? c.createdAt,
  });
  if (bestScore.total < PROPOSAL_THRESHOLD) return null;
  return {
    kind: "invoice",
    invoiceId: c.id,
    label: invoiceCandidateLabel(c),
    projectName: c.projectName ?? null,
    contractName: c.contractName ?? null,
    entityName: primaryName,
    amountHt,
    score: bestScore,
  };
}

export type MilestoneProjectCandidate = {
  id: string;
  name: string;
  entityName: string | null;
  valueAmount: string | number | null;
  budgetAmount: string | number | null;
  startDate: string | null;
  createdAt: Date | string | null;
};

/**
 * « Nouveau jalon projet » : une facture Dougs sans équivalent local
 * peut correspondre à un pourcentage standard (acompte/solde) d'un
 * projet client. Null si le nom ne passe pas le plancher, si le projet
 * n'a pas de montant, ou si le score total reste sous le seuil.
 */
export function scoreNewProjectMilestoneCandidate(
  dougs: { clientName: string | null; amount: number; createdAt: string | null },
  p: MilestoneProjectCandidate,
): NewProjectMilestoneCandidate | null {
  const projectValueHt = Number(p.valueAmount ?? p.budgetAmount ?? 0);
  if (projectValueHt <= 0) return null;
  // Dougs facture tantôt au nom de l'entité, tantôt au nom du projet —
  // on retient la meilleure des deux lectures.
  const nameSim = Math.max(
    similarityName(dougs.clientName, p.entityName),
    similarityName(dougs.clientName, p.name),
  );
  // Même plancher que scoreMatch : un montant qui tombe pile sur un
  // pourcentage standard n'est pas une preuve d'identité.
  if (nameSim < NAME_MATCH_FLOOR) return null;
  const partial = similarityAmountPartial(dougs.amount, projectValueHt);
  const dateSim = similarityDate(dougs.createdAt, p.startDate ?? p.createdAt);
  const total = Math.round((nameSim * 0.5 + partial.score * 0.3 + dateSim * 0.2) * 1000) / 1000;
  if (total < PROPOSAL_THRESHOLD) return null;
  return {
    kind: "new_project_milestone",
    projectId: p.id,
    projectName: p.name,
    entityName: p.entityName,
    projectValueHt,
    detectedPercent: partial.percent,
    amountHt: dougs.amount,
    score: { total, name: nameSim, amount: partial.score, date: dateSim },
  };
}

// =====================================================================
// Avoirs
// =====================================================================

export type CreditNoteLink = {
  cancelsDougsInvoiceId: string;
  invoice: { reference: string | null; clientName: string; totalHt: number | null } | null;
} | null;

/**
 * Résout ce qu'un avoir annule, pour l'affichage. Priorité à l'invoice
 * Paradeos annulée (label + montant local), sinon à la facture Dougs
 * connue du run courant, sinon rien de plus que l'id.
 */
export function resolveCreditNoteLink(
  row: { cancelsInvoiceId: string | null; cancelsDougsInvoiceId: string | null } | undefined,
  cancelledLocal:
    | { label: string; amountHt: string | number | null; dougsReference: string | null }
    | null
    | undefined,
  dougsCancelled:
    | (DougsAmounts & Parameters<typeof pickDougsClientName>[0] & { reference?: string | null })
    | null
    | undefined,
): CreditNoteLink {
  if (!row?.cancelsDougsInvoiceId) return null;
  return {
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
  };
}

// =====================================================================
// Liens déjà actifs
// =====================================================================

export type LinkedInvoiceStatus = "draft" | "sent" | "accepted" | "refused" | "paid";
export type LinkedInvoiceKind = "milestone" | "coworking" | "one_off";

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
    kind: LinkedInvoiceKind;
    label: string;
    amountHt: number;
    status: LinkedInvoiceStatus;
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
    kind: LinkedInvoiceKind;
    label: string;
    amountHt: number;
    projectName: string | null;
    contractName: string | null;
  }[];
  freeQuoteProjects: { id: string; name: string; entityName: string | null }[];
};

export type LinkedInvoiceRow = {
  id: string;
  kind: string;
  label: string;
  amountHt: string | number | null;
  status: string;
  billedBy: string | null;
  projectId: string | null;
  coworkingContractId: string | null;
  dougsInvoiceId: string | null;
  dougsQuoteId: string | null;
  dougsReference: string | null;
  dougsStatus: string | null;
  projectName: string | null;
  projectEntityName: string | null;
  contractName: string | null;
};

/**
 * Classe les invoices Paradeos en devis liés, factures liées et factures
 * libres (cibles possibles d'un relink). Les factures coworking G&O et
 * les avoirs sont ignorés ; un devis sans projet ou sans lien Dougs
 * n'apparaît nulle part.
 */
export function classifyLinkedInvoiceRows(
  rows: LinkedInvoiceRow[],
): Pick<LinkedDougsEntries, "quotes" | "invoices" | "freeInvoices"> {
  const quotes: LinkedDougsEntries["quotes"] = [];
  const invoices: LinkedDougsEntries["invoices"] = [];
  const freeInvoices: LinkedDougsEntries["freeInvoices"] = [];

  for (const r of rows) {
    if (r.kind === "coworking" && r.billedBy === "g_and_o") continue;
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
        invoices.push({
          invoiceId: r.id,
          dougsId: r.dougsInvoiceId,
          reference: r.dougsReference,
          kind: r.kind,
          label: r.label,
          amountHt: Number(r.amountHt) || 0,
          status: r.status as LinkedInvoiceStatus,
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

  return { quotes, invoices, freeInvoices };
}
