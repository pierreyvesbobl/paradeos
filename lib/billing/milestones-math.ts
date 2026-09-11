/**
 * Calculs des jalons de facturation projet (acompte/solde) et des
 * factures coworking. Module pur — pas de DB, pas d'API.
 */

export type MilestoneType = "acompte" | "intermediaire" | "solde";

/** Split par défaut acompte/solde : 40 % à la commande, 60 % à la livraison. */
export const DEFAULT_ACOMPTE_PERCENT = 40;

export type MilestoneSplit = {
  acompte: { percent: number; amountHt: number; label: string };
  solde: { percent: number; amountHt: number; label: string };
};

/**
 * Découpe un total HT en acompte + solde. L'acompte est arrondi au
 * centime ; le solde absorbe le reste pour que la somme retombe
 * exactement sur le total.
 */
export function splitMilestoneAmounts(
  totalHt: number,
  acomptePercent: number = DEFAULT_ACOMPTE_PERCENT,
): MilestoneSplit {
  const acompteHt = Math.round(((totalHt * acomptePercent) / 100) * 100) / 100;
  const soldeHt = Math.round((totalHt - acompteHt) * 100) / 100;
  const soldePercent = 100 - acomptePercent;
  return {
    acompte: { percent: acomptePercent, amountHt: acompteHt, label: `Acompte ${acomptePercent} %` },
    solde: { percent: soldePercent, amountHt: soldeHt, label: `Solde ${soldePercent} %` },
  };
}

export type DetectedMilestone = {
  milestoneType: MilestoneType;
  label: string;
  /** Pourcentage à stocker — cohérent avec le libellé. */
  milestonePercent: number | null;
};

/**
 * Type, libellé et pourcentage d'un jalon créé à la volée depuis une
 * facture Dougs, d'après le pourcentage détecté par le rapprochement :
 *   - < 50 → acompte ;
 *   - ≥ 95 → facture unique : solde 100 % (le % stocké est 100, pas la
 *     valeur détectée, pour que libellé et donnée concordent) ;
 *   - > 50 → solde ;
 *   - 50 pile → acompte si le projet n'en a pas encore, sinon solde
 *     (un split 50/50 est composé d'un acompte puis d'un solde) ;
 *   - inconnu → intermédiaire, libellé sur la référence.
 */
export function milestoneFromDetectedPercent(
  pct: number | null,
  reference: string | null,
  context: { hasAcompte?: boolean } = {},
): DetectedMilestone {
  if (pct == null) {
    return {
      milestoneType: "intermediaire",
      label: reference ? `Facture ${reference}` : "Facture",
      milestonePercent: null,
    };
  }
  if (pct >= 95) return { milestoneType: "solde", label: "Solde 100 %", milestonePercent: 100 };
  const isAcompte = pct < 50 || (pct === 50 && !context.hasAcompte);
  return isAcompte
    ? { milestoneType: "acompte", label: `Acompte ${pct} %`, milestonePercent: pct }
    : { milestoneType: "solde", label: `Solde ${pct} %`, milestonePercent: pct };
}

/**
 * Montant HT d'une facture coworking : postes × prix mensuel × mois,
 * arrondi au centime. Sans le facteur « mois », une facture
 * trimestrielle stockait le tiers du vrai montant.
 */
export function coworkingInvoiceAmountHt(
  desks: number,
  unitPriceHt: number,
  months: number,
): number {
  return Math.round(desks * unitPriceHt * months * 100) / 100;
}

export type CoworkingPeriod = { periodStart: string; periodEnd: string; months: number };

/** YYYY-MM-DD en heure locale (les périodes coworking sont des dates civiles). */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Période couverte par une facture coworking émise à `date` : du 1er du
 * mois au dernier jour du mois (mensuel) ou du 3e mois (trimestriel).
 */
export function coworkingPeriodFromDate(
  date: Date,
  billingFrequency: string | null,
): CoworkingPeriod {
  const months = billingFrequency === "quarterly" ? 3 : 1;
  const periodStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const periodEnd = new Date(date.getFullYear(), date.getMonth() + months, 0);
  return { periodStart: toLocalISODate(periodStart), periodEnd: toLocalISODate(periodEnd), months };
}

export type DougsInvoiceLine = {
  title: string;
  description: string;
  unit: "forfait";
  quantity: 1;
  unitAmount: number;
  vatRate: number;
  discount: 0;
  discountUnit: "%";
  reference: null;
  amount: number;
  discountInEuros: 0;
  isPriceWithVat: false;
};

/**
 * Ligne de facture Dougs pour un jalon projet : une ligne forfaitaire,
 * décrite par le pourcentage du projet quand il est connu.
 */
export function buildMilestoneDougsLine(args: {
  label: string;
  milestonePercent: number | null;
  amountHt: number;
  vatRate: number;
  projectName: string;
}): DougsInvoiceLine {
  const description =
    args.milestonePercent != null
      ? `${args.milestonePercent.toLocaleString("fr-FR")} % du projet "${args.projectName}".`
      : `Facture liée au projet "${args.projectName}".`;
  return {
    title: args.label,
    description,
    unit: "forfait",
    quantity: 1,
    unitAmount: args.amountHt,
    vatRate: args.vatRate,
    discount: 0,
    discountUnit: "%",
    reference: null,
    amount: args.amountHt,
    discountInEuros: 0,
    isPriceWithVat: false,
  };
}
