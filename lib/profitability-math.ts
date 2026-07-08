import type { ProjectBillingType } from "@/lib/schemas/projects";

/**
 * Convention FR pour convertir des heures en jours-hommes (JH) et
 * exprimer un TJM. 7h/j est le standard consulting côté France.
 */
export const HOURS_PER_DAY = 7;

/**
 * Nombre de jours-hommes (JH) réalisés à partir des minutes.
 */
export function computeDaysWorked(actualMinutes: number): number {
  return actualMinutes / 60 / HOURS_PER_DAY;
}

/**
 * TJM effectif = revenu / JH réalisés. Null si pas de temps ou pas
 * de revenu (par ex. projet R&D non facturable).
 */
export function computeEffectiveDailyRate(
  revenueAmount: number,
  actualMinutes: number,
): number | null {
  if (actualMinutes <= 0 || revenueAmount <= 0) return null;
  return revenueAmount / computeDaysWorked(actualMinutes);
}

/**
 * Calcul du revenu d'un projet selon son modèle de facturation.
 * Pure — pas d'accès DB.
 *
 *  - none   → 0 (R&D, transverses)
 *  - fixed  → budget plafonné, indépendant des heures réalisées
 *  - hourly → minutes / 60 × taux horaire
 */
export function computeRevenue(
  billingType: ProjectBillingType,
  budgetAmount: number,
  hourlyRate: number,
  actualMinutes: number,
): number {
  if (billingType === "fixed") return budgetAmount;
  if (billingType === "hourly") return (actualMinutes / 60) * hourlyRate;
  return 0;
}

/**
 * Calcule la marge €. Une marge négative = projet en perte.
 */
export function computeMargin(revenueAmount: number, costAmount: number): number {
  return revenueAmount - costAmount;
}

/**
 * Marge en % entre 0 et 100. Renvoie null si revenu nul.
 */
export function computeMarginPct(revenueAmount: number, costAmount: number): number | null {
  if (revenueAmount <= 0) return null;
  return ((revenueAmount - costAmount) / revenueAmount) * 100;
}

/**
 * Taux horaire effectif = revenu / heures réalisées. Utile pour comparer
 * un forfait à un TJM cible. Renvoie null si pas de temps ou pas de revenu.
 */
export function computeEffectiveHourlyRate(
  revenueAmount: number,
  actualMinutes: number,
): number | null {
  if (actualMinutes <= 0 || revenueAmount <= 0) return null;
  return revenueAmount / (actualMinutes / 60);
}
