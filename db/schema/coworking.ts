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

/**
 * Contrat de location de poste(s) de coworking. Un coworker (contact)
 * loue N postes sur une période à un tarif unitaire HT. Le contrat est
 * `en_cours` jusqu'à sa fin (ou résiliation), puis `termine`.
 *
 * Les factures émises à partir du contrat vivent dans `invoices`
 * (kind='coworking'). Cf. migration 0043_invoices_unified.
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

export type CoworkingContract = typeof coworkingContracts.$inferSelect;
export type NewCoworkingContract = typeof coworkingContracts.$inferInsert;
