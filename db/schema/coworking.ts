import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { entities } from "./entities";
import { users } from "./users";

export const coworkingContractStatus = pgEnum("coworking_contract_status", ["en_cours", "termine"]);

export const coworkingBillingFrequency = pgEnum("coworking_billing_frequency", [
  "monthly",
  "quarterly",
]);

export const coworkingInvoiceStatus = pgEnum("coworking_invoice_status", [
  "a_facturer",
  "envoyee",
  "payee",
]);

export const coworkingInvoiceBilledBy = pgEnum("coworking_invoice_billed_by", [
  "parade",
  "g_and_o",
]);

/**
 * Contrat de location de poste(s) de coworking. Un coworker (contact)
 * loue N postes sur une période à un tarif unitaire HT. Le contrat est
 * `en_cours` jusqu'à sa fin (ou résiliation), puis `termine`.
 */
export const coworkingContracts = pgTable(
  "coworking_contracts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** Si défini, la facture est éditée au nom de l'entité (B2B). Sinon
     *  au nom du contact (B2C). */
    billToEntityId: uuid("bill_to_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    desks: integer("desks").notNull().default(1),
    unitPriceHt: numeric("unit_price_ht", { precision: 10, scale: 2 }).notNull().default("0"),
    status: coworkingContractStatus("status").notNull().default("en_cours"),
    billingFrequency: coworkingBillingFrequency("billing_frequency").notNull().default("quarterly"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    contactIdx: index("coworking_contracts_contact_idx").on(table.contactId),
    billToEntityIdx: index("coworking_contracts_bill_to_entity_idx").on(table.billToEntityId),
    statusIdx: index("coworking_contracts_status_idx").on(table.status),
  }),
);

/**
 * Facture émise contre un contrat de coworking. Snapshot des montants
 * (`desks`, `unitPriceHt`, `vatRate`) au moment de l'émission pour
 * figer la facture même si le contrat évolue ensuite.
 *
 * Pas de numéro légal stocké ici — c'est Dougs qui le génère à la
 * finalisation. `dougsInvoiceId` est posé après push réussi.
 */
export const coworkingInvoices = pgTable(
  "coworking_invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => coworkingContracts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    invoiceDate: date("invoice_date"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: coworkingInvoiceStatus("status").notNull().default("a_facturer"),
    billedBy: coworkingInvoiceBilledBy("billed_by").notNull().default("parade"),
    desks: integer("desks").notNull(),
    unitPriceHt: numeric("unit_price_ht", { precision: 10, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.2"),
    notes: text("notes"),
    dougsInvoiceId: text("dougs_invoice_id"),
    // Snapshot Dougs après refresh (manuel ou cron). Permet d'afficher
    // référence finale, statut, totaux recalculés, dates émission/paiement
    // sans re-fetch à chaque rendu. Cf. refreshCoworkingInvoiceDougs.
    dougsInvoiceReference: text("dougs_invoice_reference"),
    dougsInvoiceStatus: text("dougs_invoice_status"),
    dougsInvoiceTotalHt: numeric("dougs_invoice_total_ht", { precision: 12, scale: 2 }),
    dougsInvoiceTotalTtc: numeric("dougs_invoice_total_ttc", { precision: 12, scale: 2 }),
    dougsInvoiceTotalVat: numeric("dougs_invoice_total_vat", { precision: 12, scale: 2 }),
    dougsInvoiceIssuedAt: timestamp("dougs_invoice_issued_at", { withTimezone: true }),
    dougsInvoicePaidAt: timestamp("dougs_invoice_paid_at", { withTimezone: true }),
    dougsInvoiceSyncedAt: timestamp("dougs_invoice_synced_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    contractIdx: index("coworking_invoices_contract_idx").on(table.contractId),
    statusIdx: index("coworking_invoices_status_idx").on(table.status),
    periodIdx: index("coworking_invoices_period_idx").on(table.periodStart),
  }),
);

export type CoworkingContract = typeof coworkingContracts.$inferSelect;
export type NewCoworkingContract = typeof coworkingContracts.$inferInsert;
export type CoworkingInvoice = typeof coworkingInvoices.$inferSelect;
export type NewCoworkingInvoice = typeof coworkingInvoices.$inferInsert;
