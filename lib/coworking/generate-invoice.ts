import "server-only";

import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { db } from "@/lib/db/server";
import { coworkingBillingFrequencyMonths } from "@/lib/schemas/coworking";
import { and, desc, eq } from "drizzle-orm";

type Result =
  | { ok: true; created: true; id: string; periodStart: string; periodEnd: string; name: string }
  | { ok: true; created: false; reason: "future" | "contract_terminated" | "missing_contract" }
  | { ok: false; message: string };

/**
 * Calcule la facture suivante pour un contrat et la crée en
 * `a_facturer` si elle est due (ou si `forceFuture=true`).
 *
 * - `forceFuture=true` (bouton manuel) : crée toujours, même si la
 *   période est dans le futur.
 * - `forceFuture=false` (cron mensuel) : skip si periodStart > today,
 *   pour ne pas générer en avance des factures qu'on n'aurait pas dû.
 */
export async function generateNextInvoiceForContract(opts: {
  contractId: string;
  today?: Date;
  createdBy?: string | null;
  forceFuture?: boolean;
}): Promise<Result> {
  const { contractId, createdBy = null, forceFuture = false } = opts;
  const today = opts.today ?? new Date();
  today.setHours(0, 0, 0, 0);

  const conn = await db();
  const [contract] = await conn
    .select()
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, contractId))
    .limit(1);
  if (!contract) return { ok: true, created: false, reason: "missing_contract" };
  if (contract.status === "termine") {
    return { ok: true, created: false, reason: "contract_terminated" };
  }

  const months = coworkingBillingFrequencyMonths[contract.billingFrequency];

  const [last] = await conn
    .select({ periodEnd: invoices.periodEnd })
    .from(invoices)
    .where(and(eq(invoices.coworkingContractId, contractId), eq(invoices.kind, "coworking")))
    .orderBy(desc(invoices.periodStart))
    .limit(1);

  const refDate = last?.periodEnd
    ? addDays(parseDate(last.periodEnd), 1)
    : parseDate(contract.startDate);
  const periodStart = firstOfMonth(refDate);
  const periodEnd = lastOfMonth(addMonths(periodStart, months - 1));

  if (!forceFuture && periodStart > today) {
    return { ok: true, created: false, reason: "future" };
  }

  const periodLabel = labelForPeriod(periodStart, contract.billingFrequency);
  const amountHt = Number(contract.unitPriceHt) * contract.desks * months;

  const [row] = await conn
    .insert(invoices)
    .values({
      kind: "coworking",
      coworkingContractId: contractId,
      label: periodLabel,
      amountHt: amountHt.toFixed(2),
      vatRate: "0.2",
      status: "draft",
      periodStart: fmtDate(periodStart),
      periodEnd: fmtDate(periodEnd),
      desks: contract.desks,
      unitPriceHt: contract.unitPriceHt,
      billedBy: "parade",
      createdBy,
    })
    .returning({ id: invoices.id });

  if (!row) return { ok: false, message: "Insert sans retour." };

  return {
    ok: true,
    created: true,
    id: row.id,
    periodStart: fmtDate(periodStart),
    periodEnd: fmtDate(periodEnd),
    name: periodLabel,
  };
}

// ---------- Helpers de date ----------

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function lastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function labelForPeriod(start: Date, freq: "monthly" | "quarterly"): string {
  const year = start.getFullYear();
  if (freq === "monthly") {
    const monthName = start.toLocaleDateString("fr-FR", { month: "long" });
    return `${monthName} ${year}`;
  }
  const q = Math.floor(start.getMonth() / 3) + 1;
  return `T${q} ${year}`;
}
