import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { coworkingContracts } from "../../db/schema/coworking";
import { invoices as invoicesTable } from "../../db/schema/invoices";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

const contractStatusEnum = z.enum(["en_cours", "termine"]);
const billingFrequencyEnum = z.enum(["monthly", "quarterly"]);
const invoiceStatusEnum = z.enum(["a_facturer", "envoyee", "payee"]);
const invoiceBilledByEnum = z.enum(["parade", "g_and_o"]);

export const listCoworkingContractsSchema = z.object({
  status: contractStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listCoworkingContracts(args: z.infer<typeof listCoworkingContractsSchema>) {
  const conn = db();
  const conds = [];
  if (args.status) conds.push(eq(coworkingContracts.status, args.status));
  if (args.contactId) conds.push(eq(coworkingContracts.contactId, args.contactId));
  return conn
    .select({
      id: coworkingContracts.id,
      name: coworkingContracts.name,
      contactId: coworkingContracts.contactId,
      billToEntityId: coworkingContracts.billToEntityId,
      startDate: coworkingContracts.startDate,
      endDate: coworkingContracts.endDate,
      desks: coworkingContracts.desks,
      unitPriceHt: coworkingContracts.unitPriceHt,
      status: coworkingContracts.status,
      billingFrequency: coworkingContracts.billingFrequency,
    })
    .from(coworkingContracts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(coworkingContracts.startDate))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const getCoworkingContractSchema = z.object({ id: z.string().uuid() });

export async function getCoworkingContract(args: z.infer<typeof getCoworkingContractSchema>) {
  const conn = db();
  const [contract] = await conn
    .select()
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, args.id))
    .limit(1);
  if (!contract) return null;

  const invoiceRows = await conn
    .select({
      id: invoicesTable.id,
      name: invoicesTable.label,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      invoiceDate: invoicesTable.invoicedAt,
      status: invoicesTable.status,
      billedBy: invoicesTable.billedBy,
      desks: invoicesTable.desks,
      unitPriceHt: invoicesTable.unitPriceHt,
      vatRate: invoicesTable.vatRate,
      dougsInvoiceId: invoicesTable.dougsInvoiceId,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.coworkingContractId, args.id), eq(invoicesTable.kind, "coworking")))
    .orderBy(asc(invoicesTable.periodStart));

  return { contract, invoices: invoiceRows };
}

export const createCoworkingContractSchema = z.object({
  name: z.string().min(1).max(200),
  contactId: z.string().uuid().optional(),
  billToEntityId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  desks: z.number().int().positive(),
  unitPriceHt: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: contractStatusEnum.optional(),
  billingFrequency: billingFrequencyEnum.optional(),
  notes: z.string().max(5000).optional(),
});

export async function createCoworkingContract(
  args: z.infer<typeof createCoworkingContractSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [row] = await conn
    .insert(coworkingContracts)
    .values({
      name: args.name,
      contactId: args.contactId ?? null,
      billToEntityId: args.billToEntityId ?? null,
      startDate: args.startDate,
      endDate: args.endDate ?? null,
      desks: args.desks,
      unitPriceHt: args.unitPriceHt,
      status: args.status ?? "en_cours",
      billingFrequency: args.billingFrequency ?? "quarterly",
      notes: args.notes ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: coworkingContracts.id, name: coworkingContracts.name });
  return row;
}

export const updateCoworkingContractSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  contactId: z.string().uuid().nullable().optional(),
  billToEntityId: z.string().uuid().nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .nullable()
    .optional(),
  desks: z.number().int().positive().optional(),
  unitPriceHt: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional(),
  status: contractStatusEnum.optional(),
  billingFrequency: billingFrequencyEnum.optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateCoworkingContract(args: z.infer<typeof updateCoworkingContractSchema>) {
  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    "name",
    "contactId",
    "billToEntityId",
    "startDate",
    "endDate",
    "desks",
    "unitPriceHt",
    "status",
    "billingFrequency",
    "notes",
  ] as const) {
    const v = (args as Record<string, unknown>)[key];
    if (v !== undefined) update[key] = v;
  }
  await conn.update(coworkingContracts).set(update).where(eq(coworkingContracts.id, args.id));
  return { id: args.id };
}

export const listCoworkingInvoicesSchema = z.object({
  contractId: z.string().uuid().optional(),
  status: invoiceStatusEnum.optional(),
  limit: z.number().int().positive().max(200).optional(),
});

// Mapping API publique (anciennes valeurs) ↔ DB (nouvelles).
function toDbStatusCoworking(s: "a_facturer" | "envoyee" | "payee"): "draft" | "sent" | "paid" {
  if (s === "envoyee") return "sent";
  if (s === "payee") return "paid";
  return "draft";
}
function fromDbStatusCoworking(s: string): "a_facturer" | "envoyee" | "payee" {
  if (s === "sent") return "envoyee";
  if (s === "paid") return "payee";
  return "a_facturer";
}

export async function listCoworkingInvoices(args: z.infer<typeof listCoworkingInvoicesSchema>) {
  const conn = db();
  const conds = [eq(invoicesTable.kind, "coworking" as const)];
  if (args.contractId) conds.push(eq(invoicesTable.coworkingContractId, args.contractId));
  if (args.status) conds.push(eq(invoicesTable.status, toDbStatusCoworking(args.status)));
  const rows = await conn
    .select({
      id: invoicesTable.id,
      contractId: invoicesTable.coworkingContractId,
      contractName: coworkingContracts.name,
      name: invoicesTable.label,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      invoiceDate: invoicesTable.invoicedAt,
      status: invoicesTable.status,
      billedBy: invoicesTable.billedBy,
      desks: invoicesTable.desks,
      unitPriceHt: invoicesTable.unitPriceHt,
      vatRate: invoicesTable.vatRate,
      dougsInvoiceId: invoicesTable.dougsInvoiceId,
    })
    .from(invoicesTable)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoicesTable.coworkingContractId))
    .where(and(...conds))
    .orderBy(desc(invoicesTable.periodStart))
    .limit(args.limit ?? DEFAULT_LIMIT);
  return rows.map((r) => ({
    ...r,
    status: fromDbStatusCoworking(r.status),
    invoiceDate: r.invoiceDate
      ? `${r.invoiceDate.getFullYear()}-${String(r.invoiceDate.getMonth() + 1).padStart(2, "0")}-${String(r.invoiceDate.getDate()).padStart(2, "0")}`
      : null,
  }));
}

export const createCoworkingInvoiceSchema = z.object({
  contractId: z.string().uuid(),
  name: z.string().min(1).max(200),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  status: invoiceStatusEnum.optional(),
  billedBy: invoiceBilledByEnum.optional(),
  vatRate: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional(),
  notes: z.string().max(5000).optional(),
});

export async function createCoworkingInvoice(
  args: z.infer<typeof createCoworkingInvoiceSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [contract] = await conn
    .select({ desks: coworkingContracts.desks, unitPriceHt: coworkingContracts.unitPriceHt })
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, args.contractId))
    .limit(1);
  if (!contract) throw new Error("Contrat introuvable.");

  // Période × prix mensuel — mensuel × 1, trimestriel × 3 si on couvre
  // 3 mois. On dérive `months` de la période passée en arg.
  const startD = new Date(`${args.periodStart}T00:00:00`);
  const endD = new Date(`${args.periodEnd}T00:00:00`);
  const months = Math.max(
    1,
    (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth()) + 1,
  );
  const amountHt = Number(contract.unitPriceHt) * contract.desks * months;
  const [row] = await conn
    .insert(invoicesTable)
    .values({
      kind: "coworking",
      coworkingContractId: args.contractId,
      label: args.name,
      amountHt: amountHt.toFixed(2),
      vatRate: args.vatRate ?? "0.2",
      status: toDbStatusCoworking(args.status ?? "a_facturer"),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      desks: contract.desks,
      unitPriceHt: contract.unitPriceHt,
      billedBy: args.billedBy ?? "parade",
      invoicedAt: args.invoiceDate ? new Date(args.invoiceDate) : null,
      notes: args.notes ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: invoicesTable.id, name: invoicesTable.label });
  return row;
}

export const updateCoworkingInvoiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .nullable()
    .optional(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  status: invoiceStatusEnum.optional(),
  billedBy: invoiceBilledByEnum.optional(),
  vatRate: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateCoworkingInvoice(args: z.infer<typeof updateCoworkingInvoiceSchema>) {
  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.name !== undefined) update.label = args.name;
  if (args.invoiceDate !== undefined) {
    update.invoicedAt = args.invoiceDate ? new Date(args.invoiceDate) : null;
  }
  if (args.periodStart !== undefined) update.periodStart = args.periodStart;
  if (args.periodEnd !== undefined) update.periodEnd = args.periodEnd;
  if (args.status !== undefined) update.status = toDbStatusCoworking(args.status);
  if (args.billedBy !== undefined) update.billedBy = args.billedBy;
  if (args.vatRate !== undefined) update.vatRate = args.vatRate;
  if (args.notes !== undefined) update.notes = args.notes;
  await conn.update(invoicesTable).set(update).where(eq(invoicesTable.id, args.id));
  return { id: args.id };
}

/**
 * Génère la facture suivante pour un contrat. Période = lendemain de
 * la dernière facture (ou contrat.startDate si aucune) + N mois selon
 * billing_frequency. Statut initial `a_facturer`.
 *
 * Implémentation inlinée (le helper `lib/coworking/generate-invoice.ts`
 * dépend de Next via `server-only` et des path aliases — incompatible
 * avec le runtime tsx standalone du MCP stdio).
 */
export const generateNextCoworkingInvoiceSchema = z.object({
  contractId: z.string().uuid(),
});

export async function generateNextCoworkingInvoice(
  args: z.infer<typeof generateNextCoworkingInvoiceSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [contract] = await conn
    .select()
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, args.contractId))
    .limit(1);
  if (!contract) throw new Error("Contrat introuvable.");
  if (contract.status === "termine") throw new Error("Contrat terminé — pas de facture suivante.");

  const months = contract.billingFrequency === "monthly" ? 1 : 3;

  const [last] = await conn
    .select({ periodEnd: invoicesTable.periodEnd })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.coworkingContractId, args.contractId),
        eq(invoicesTable.kind, "coworking"),
      ),
    )
    .orderBy(desc(invoicesTable.periodStart))
    .limit(1);

  const refDate = last?.periodEnd
    ? addDays(parseDate(last.periodEnd), 1)
    : parseDate(contract.startDate);
  const periodStart = firstOfMonth(refDate);
  const periodEnd = lastOfMonth(addMonths(periodStart, months - 1));
  const label = periodLabel(periodStart, contract.billingFrequency);
  const amountHt = Number(contract.unitPriceHt) * contract.desks * months;

  const [row] = await conn
    .insert(invoicesTable)
    .values({
      kind: "coworking",
      coworkingContractId: args.contractId,
      label,
      amountHt: amountHt.toFixed(2),
      vatRate: "0.2",
      status: "draft",
      periodStart: fmtDate(periodStart),
      periodEnd: fmtDate(periodEnd),
      desks: contract.desks,
      unitPriceHt: contract.unitPriceHt,
      billedBy: "parade",
      createdBy: ctx.userId,
    })
    .returning({ id: invoicesTable.id, name: invoicesTable.label });
  return {
    ...row,
    periodStart: fmtDate(periodStart),
    periodEnd: fmtDate(periodEnd),
  };
}

// ---------- Helpers de date (locaux) ----------

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
function periodLabel(start: Date, freq: "monthly" | "quarterly"): string {
  const year = start.getFullYear();
  if (freq === "monthly") {
    const monthName = start.toLocaleDateString("fr-FR", { month: "long" });
    return `${monthName} ${year}`;
  }
  const q = Math.floor(start.getMonth() / 3) + 1;
  return `T${q} ${year}`;
}
