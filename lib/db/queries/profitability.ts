import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import {
  computeEffectiveHourlyRate,
  computeMargin,
  computeMarginPct,
  computeRevenue,
} from "@/lib/profitability-math";
import type { ProjectBillingType } from "@/lib/schemas/projects";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

/**
 * Pour une time entry réalisée, le coût est `(durée minutes / 60) × user.cost_rate_hourly`.
 * Les entries sans cost_rate user comptent pour 0€.
 */
const actualMinutesExpr = sql<number>`(extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60)::int`;
const actualCostExpr = sql<number>`coalesce(
  (extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 3600)
    * coalesce(${users.costRateHourly}::numeric, 0),
  0
)::numeric(12,2)`;

const sumActualMinutes = sql<number>`coalesce(sum(
  case when ${timeEntries.kind} = 'actual'
    then (extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60)
    else 0
  end
), 0)::int`;
const sumActualCost = sql<string>`coalesce(sum(
  case when ${timeEntries.kind} = 'actual'
    then (extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 3600)
        * coalesce(${users.costRateHourly}::numeric, 0)
    else 0
  end
), 0)::numeric(12,2)`;

export type Profitability = {
  billingType: ProjectBillingType;
  budgetAmount: number; // €HT
  hourlyRate: number; // €HT/h
  actualMinutes: number;
  /** Revenu calculé selon billingType. */
  revenueAmount: number;
  /** Coût interne (heures × cost_rate par user). */
  costAmount: number;
  /** Marge € = revenu - coût. */
  marginAmount: number;
  /** Marge en % (0-100), null si revenue=0. */
  marginPct: number | null;
  /** Taux horaire effectif = revenue / heures, utile pour les forfaits. */
  effectiveHourlyRate: number | null;
};

export async function getProjectProfitability(projectId: string): Promise<Profitability> {
  const conn = await db();

  const [project] = await conn
    .select({
      billingType: projects.billingType,
      budgetAmount: projects.budgetAmount,
      hourlyRate: projects.hourlyRate,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      billingType: "none",
      budgetAmount: 0,
      hourlyRate: 0,
      actualMinutes: 0,
      revenueAmount: 0,
      costAmount: 0,
      marginAmount: 0,
      marginPct: null,
      effectiveHourlyRate: null,
    };
  }

  // Inclut le temps avant-vente : opportunités déjà converties en ce projet.
  const linkedOppRows = await conn
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.projectId, projectId));
  const linkedOppIds = linkedOppRows.map((r) => r.id);

  const projectFilter = eq(timeEntries.projectId, projectId);
  const presaleFilter =
    linkedOppIds.length > 0 ? inArray(timeEntries.opportunityId, linkedOppIds) : undefined;
  const filter = presaleFilter ? or(projectFilter, presaleFilter) : projectFilter;

  const [agg] = await conn
    .select({
      actualMinutes: sumActualMinutes,
      costAmount: sumActualCost,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .where(filter);

  const billingType = project.billingType;
  const budgetAmount = Number(project.budgetAmount ?? 0);
  const hourlyRate = Number(project.hourlyRate ?? 0);
  const actualMinutes = agg?.actualMinutes ?? 0;
  const costAmount = Number(agg?.costAmount ?? 0);
  const revenueAmount = computeRevenue(billingType, budgetAmount, hourlyRate, actualMinutes);
  const marginAmount = computeMargin(revenueAmount, costAmount);
  const marginPct = computeMarginPct(revenueAmount, costAmount);
  const effectiveHourlyRate = computeEffectiveHourlyRate(revenueAmount, actualMinutes);

  return {
    billingType,
    budgetAmount,
    hourlyRate,
    actualMinutes,
    revenueAmount,
    costAmount,
    marginAmount,
    marginPct,
    effectiveHourlyRate,
  };
}

/** Rentabilité globale projet par projet sur une période. */
export async function getGlobalProfitability(start: Date, end: Date) {
  const conn = await db();

  const rows = await conn
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectKind: projects.kind,
      billingType: projects.billingType,
      budgetAmount: projects.budgetAmount,
      hourlyRate: projects.hourlyRate,
      actualMinutes: sumActualMinutes,
      costAmount: sumActualCost,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(gte(timeEntries.startAt, start), lt(timeEntries.startAt, end)))
    .groupBy(
      projects.id,
      projects.name,
      projects.kind,
      projects.billingType,
      projects.budgetAmount,
      projects.hourlyRate,
    )
    .orderBy(desc(sumActualMinutes));

  return rows.map((r) => {
    const billingType = r.billingType;
    const budgetAmount = Number(r.budgetAmount ?? 0);
    const hourlyRate = Number(r.hourlyRate ?? 0);
    const actualMinutes = r.actualMinutes;
    const costAmount = Number(r.costAmount);
    const revenueAmount = computeRevenue(billingType, budgetAmount, hourlyRate, actualMinutes);
    const marginAmount = computeMargin(revenueAmount, costAmount);
    const marginPct = computeMarginPct(revenueAmount, costAmount);
    return {
      projectId: r.projectId,
      projectName: r.projectName,
      projectKind: r.projectKind,
      billingType,
      actualMinutes,
      revenueAmount,
      costAmount,
      marginAmount,
      marginPct,
    };
  });
}

// Re-export pour éviter "unused" sur les expressions partielles.
export const _exprs = { actualMinutesExpr, actualCostExpr };
