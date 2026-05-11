import { contacts } from "@/db/schema/contacts";
import { coworkingContracts, coworkingInvoices } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { asc, desc, eq } from "drizzle-orm";

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
  // Les `desks`/`unitPriceHt`/`vatRate` exposés viennent du **contrat**
  // (rollup live, comme dans Notion). Les colonnes snapshot sur la table
  // facture restent en DB en cas de suppression du contrat parent (cf. fallback).
  const rows = await conn
    .select({
      id: coworkingInvoices.id,
      contractId: coworkingInvoices.contractId,
      contractName: coworkingContracts.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      name: coworkingInvoices.name,
      invoiceDate: coworkingInvoices.invoiceDate,
      periodStart: coworkingInvoices.periodStart,
      periodEnd: coworkingInvoices.periodEnd,
      status: coworkingInvoices.status,
      billedBy: coworkingInvoices.billedBy,
      contractDesks: coworkingContracts.desks,
      contractUnitPriceHt: coworkingContracts.unitPriceHt,
      snapshotDesks: coworkingInvoices.desks,
      snapshotUnitPriceHt: coworkingInvoices.unitPriceHt,
      vatRate: coworkingInvoices.vatRate,
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .orderBy(desc(coworkingInvoices.periodStart));

  return rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    contractName: r.contractName ?? "(contrat supprimé)",
    contactName:
      r.contactFirstName || r.contactLastName
        ? `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim()
        : null,
    name: r.name,
    invoiceDate: r.invoiceDate,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: r.status,
    billedBy: r.billedBy,
    desks: r.contractDesks ?? r.snapshotDesks,
    unitPriceHt: r.contractUnitPriceHt ?? r.snapshotUnitPriceHt,
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

  const invoices = await conn
    .select()
    .from(coworkingInvoices)
    .where(eq(coworkingInvoices.contractId, id))
    .orderBy(asc(coworkingInvoices.periodStart));

  return {
    contract: {
      ...contract,
      contactName:
        contract.contactFirstName || contract.contactLastName
          ? `${contract.contactFirstName ?? ""} ${contract.contactLastName ?? ""}`.trim()
          : null,
    },
    invoices,
  };
}

export async function getCoworkingInvoice(id: string) {
  const conn = await db();
  const [row] = await conn
    .select({
      invoice: coworkingInvoices,
      contractName: coworkingContracts.name,
      contractId: coworkingContracts.id,
      contractDesks: coworkingContracts.desks,
      contractUnitPriceHt: coworkingContracts.unitPriceHt,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
    .where(eq(coworkingInvoices.id, id))
    .limit(1);

  if (!row) return null;
  // `desks` / `unitPriceHt` exposés = valeurs **vivantes** du contrat
  // (Notion-style rollup). On overwrite le snapshot.
  return {
    ...row.invoice,
    desks: row.contractDesks ?? row.invoice.desks,
    unitPriceHt: row.contractUnitPriceHt ?? row.invoice.unitPriceHt,
    contractName: row.contractName ?? "(contrat supprimé)",
    contractId: row.contractId,
    contactName:
      row.contactFirstName || row.contactLastName
        ? `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim()
        : null,
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
