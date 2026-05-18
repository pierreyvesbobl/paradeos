import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { db } from "@/lib/db/server";
import { and, asc, desc, eq } from "drizzle-orm";

export type ContractListRow = {
  id: string;
  name: string;
  contactId: string | null;
  contactName: string | null;
  startDate: string;
  endDate: string | null;
  desks: number;
  unitPriceHt: string;
  status: "en_cours" | "termine";
  updatedAt: Date;
};

export async function listCoworkingContracts(): Promise<ContractListRow[]> {
  const conn = await db();
  const rows = await conn
    .select({
      id: coworkingContracts.id,
      name: coworkingContracts.name,
      contactId: coworkingContracts.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      startDate: coworkingContracts.startDate,
      endDate: coworkingContracts.endDate,
      desks: coworkingContracts.desks,
      unitPriceHt: coworkingContracts.unitPriceHt,
      status: coworkingContracts.status,
      updatedAt: coworkingContracts.updatedAt,
    })
    .from(coworkingContracts)
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .orderBy(desc(coworkingContracts.startDate));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactId: r.contactId,
    contactName:
      r.contactFirstName || r.contactLastName
        ? `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim()
        : null,
    startDate: r.startDate,
    endDate: r.endDate,
    desks: r.desks,
    unitPriceHt: r.unitPriceHt,
    status: r.status,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Mapping ancien statut UI ↔ nouveau statut DB :
 *   a_facturer → draft
 *   envoyee    → sent
 *   payee      → paid
 * On expose le statut historique pour minimiser le diff UI.
 */
function toOldCoworkingStatus(status: string): "a_facturer" | "envoyee" | "payee" {
  switch (status) {
    case "sent":
      return "envoyee";
    case "paid":
      return "payee";
    default:
      return "a_facturer";
  }
}

export type InvoiceListRow = {
  id: string;
  contractId: string;
  contractName: string;
  contactName: string | null;
  name: string;
  invoiceDate: string | null;
  periodStart: string;
  periodEnd: string;
  status: "a_facturer" | "envoyee" | "payee";
  billedBy: "parade" | "g_and_o";
  desks: number;
  unitPriceHt: string;
  vatRate: string;
};

export async function listCoworkingInvoices(): Promise<InvoiceListRow[]> {
  const conn = await db();
  const rows = await conn
    .select({
      id: invoices.id,
      contractId: invoices.coworkingContractId,
      contractName: coworkingContracts.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      label: invoices.label,
      invoicedAt: invoices.invoicedAt,
      periodStart: invoices.periodStart,
      periodEnd: invoices.periodEnd,
      status: invoices.status,
      billedBy: invoices.billedBy,
      contractDesks: coworkingContracts.desks,
      contractUnitPriceHt: coworkingContracts.unitPriceHt,
      snapshotDesks: invoices.desks,
      snapshotUnitPriceHt: invoices.unitPriceHt,
      vatRate: invoices.vatRate,
    })
    .from(invoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .where(eq(invoices.kind, "coworking"))
    .orderBy(desc(invoices.periodStart));

  return rows.map((r) => ({
    id: r.id,
    contractId: r.contractId ?? "",
    contractName: r.contractName ?? "(contrat supprimé)",
    contactName:
      r.contactFirstName || r.contactLastName
        ? `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim()
        : null,
    name: r.label,
    invoiceDate: r.invoicedAt
      ? `${r.invoicedAt.getFullYear()}-${String(r.invoicedAt.getMonth() + 1).padStart(2, "0")}-${String(r.invoicedAt.getDate()).padStart(2, "0")}`
      : null,
    periodStart: r.periodStart ?? "",
    periodEnd: r.periodEnd ?? "",
    status: toOldCoworkingStatus(r.status),
    billedBy: (r.billedBy as "parade" | "g_and_o") ?? "parade",
    desks: r.contractDesks ?? r.snapshotDesks ?? 1,
    unitPriceHt: r.contractUnitPriceHt ?? r.snapshotUnitPriceHt ?? "0",
    vatRate: r.vatRate,
  }));
}

export async function getCoworkingContractWithInvoices(id: string) {
  const conn = await db();
  const [contract] = await conn
    .select({
      id: coworkingContracts.id,
      name: coworkingContracts.name,
      contactId: coworkingContracts.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      startDate: coworkingContracts.startDate,
      endDate: coworkingContracts.endDate,
      desks: coworkingContracts.desks,
      unitPriceHt: coworkingContracts.unitPriceHt,
      status: coworkingContracts.status,
      billingFrequency: coworkingContracts.billingFrequency,
      billToEntityId: coworkingContracts.billToEntityId,
      billToEntityName: entities.name,
      notes: coworkingContracts.notes,
      createdAt: coworkingContracts.createdAt,
      updatedAt: coworkingContracts.updatedAt,
    })
    .from(coworkingContracts)
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
    .where(eq(coworkingContracts.id, id))
    .limit(1);

  if (!contract) return null;

  const cwInvoices = await conn
    .select()
    .from(invoices)
    .where(and(eq(invoices.coworkingContractId, id), eq(invoices.kind, "coworking")))
    .orderBy(asc(invoices.periodStart));

  // On expose les invoices avec les anciens noms de champs pour
  // minimiser le diff dans les pages /coworking/contrats/[id].
  const adapted = cwInvoices.map((i) => ({
    ...i,
    name: i.label,
    contractId: i.coworkingContractId,
    invoiceDate: i.invoicedAt
      ? `${i.invoicedAt.getFullYear()}-${String(i.invoicedAt.getMonth() + 1).padStart(2, "0")}-${String(i.invoicedAt.getDate()).padStart(2, "0")}`
      : null,
    status: toOldCoworkingStatus(i.status),
    desks: i.desks ?? 1,
    unitPriceHt: i.unitPriceHt ?? "0",
    dougsInvoiceId: i.dougsInvoiceId,
    dougsInvoiceReference: i.dougsReference,
    dougsInvoiceStatus: i.dougsStatus,
    dougsInvoiceTotalHt: i.dougsTotalHt,
    dougsInvoiceTotalVat: i.dougsTotalVat,
    dougsInvoiceTotalTtc: i.dougsTotalTtc,
    dougsInvoiceIssuedAt: i.dougsIssuedAt,
    dougsInvoicePaidAt: i.dougsPaidAt,
    dougsInvoiceSyncedAt: i.dougsSyncedAt,
  }));

  return {
    contract: {
      ...contract,
      contactName:
        contract.contactFirstName || contract.contactLastName
          ? `${contract.contactFirstName ?? ""} ${contract.contactLastName ?? ""}`.trim()
          : null,
    },
    invoices: adapted,
  };
}

export async function getCoworkingInvoice(id: string) {
  const conn = await db();
  const [row] = await conn
    .select({
      invoice: invoices,
      contractName: coworkingContracts.name,
      contractId: coworkingContracts.id,
      contractDesks: coworkingContracts.desks,
      contractUnitPriceHt: coworkingContracts.unitPriceHt,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
    })
    .from(invoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .where(and(eq(invoices.id, id), eq(invoices.kind, "coworking")))
    .limit(1);

  if (!row) return null;

  const i = row.invoice;
  // On expose les champs avec les anciens noms pour minimiser le diff.
  return {
    ...i,
    name: i.label,
    contractId: i.coworkingContractId,
    invoiceDate: i.invoicedAt
      ? `${i.invoicedAt.getFullYear()}-${String(i.invoicedAt.getMonth() + 1).padStart(2, "0")}-${String(i.invoicedAt.getDate()).padStart(2, "0")}`
      : null,
    desks: row.contractDesks ?? i.desks ?? 1,
    unitPriceHt: row.contractUnitPriceHt ?? i.unitPriceHt ?? "0",
    status: toOldCoworkingStatus(i.status),
    contractName: row.contractName ?? "(contrat supprimé)",
    contactName:
      row.contactFirstName || row.contactLastName
        ? `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim()
        : null,
    dougsInvoiceId: i.dougsInvoiceId,
    dougsInvoiceReference: i.dougsReference,
    dougsInvoiceStatus: i.dougsStatus,
    dougsInvoiceTotalHt: i.dougsTotalHt,
    dougsInvoiceTotalVat: i.dougsTotalVat,
    dougsInvoiceTotalTtc: i.dougsTotalTtc,
    dougsInvoiceIssuedAt: i.dougsIssuedAt,
    dougsInvoicePaidAt: i.dougsPaidAt,
    dougsInvoiceSyncedAt: i.dougsSyncedAt,
  };
}

export async function listCoworkers() {
  const conn = await db();
  return conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(eq(contacts.qualification, "coworker"))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName));
}
