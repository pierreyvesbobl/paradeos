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
import { coworkingContracts } from "./coworking";
import { projects } from "./projects";
import { users } from "./users";

/**
 * Type de facture. Unifie devis, jalons projet, factures coworking,
 * factures libres et avoirs sous un seul modèle. Cf. migration 0043.
 */
export const invoiceKind = pgEnum("invoice_kind", [
  "quote",
  "milestone",
  "coworking",
  "one_off",
  "credit_note",
]);

/**
 * Cycle de vie unifié :
 *   draft     — équivalent ancien `todo` / `a_facturer` (planifié non émis)
 *   sent      — équivalent `invoiced` / `envoyee` (émis, en attente de paiement / acceptation)
 *   accepted  — devis accepté par le client (kind=quote)
 *   refused   — devis refusé (kind=quote)
 *   paid      — facture payée (kind=milestone | coworking | one_off)
 */
export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "sent",
  "accepted",
  "refused",
  "paid",
]);

/**
 * Table unique pour toute la facturation Paradeos (devis + factures
 * jalons projet + factures coworking + factures libres + avoirs).
 *
 *  - `kind` distingue les sous-types ; certains champs ne sont
 *    pertinents que pour un kind donné (ex : `period_start` pour
 *    coworking, `milestone_type` pour milestone).
 *  - `project_id` / `coworking_contract_id` : liens métier nullables.
 *  - `cancels_invoice_id` : pour kind=credit_note, pointe vers la
 *    facture annulée.
 *  - Le snapshot Dougs (dougs_*) est partagé. Pour un devis on utilise
 *    `dougs_quote_id`, pour les autres `dougs_invoice_id`. Les totaux/
 *    statut/dates sont communs.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: invoiceKind("kind").notNull(),

    // Liens métier (nullable selon kind).
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    coworkingContractId: uuid("coworking_contract_id").references(() => coworkingContracts.id, {
      onDelete: "set null",
    }),
    /** Pour kind=credit_note, pointe vers la facture annulée (côté Paradeos).
     *  Null si la facture Dougs annulée n'a pas (ou plus) de Paradeos
     *  correspondante. Pour cet usage, voir aussi `cancelsDougsInvoiceId`. */
    cancelsInvoiceId: uuid("cancels_invoice_id"),
    /** Pour kind=credit_note, ID Dougs de la facture annulée. Toujours
     *  set quand on lie un avoir à une facture, même si pas de Paradeos
     *  correspondante. Permet la traçabilité visuelle malgré le cascade. */
    cancelsDougsInvoiceId: text("cancels_dougs_invoice_id"),

    // Identité
    label: text("label").notNull(),
    reference: text("reference"),
    notes: text("notes"),

    // Montants
    amountHt: numeric("amount_ht", { precision: 12, scale: 2 }).notNull().default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.2"),

    // Cycle de vie
    status: invoiceStatus("status").notNull().default("draft"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    // Spec milestone
    milestoneType: text("milestone_type"),
    milestonePercent: integer("milestone_percent"),

    // Spec coworking
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    desks: integer("desks"),
    unitPriceHt: numeric("unit_price_ht", { precision: 10, scale: 2 }),
    billedBy: text("billed_by"),

    // Snapshot Dougs (un seul jeu, peu importe le kind)
    dougsInvoiceId: text("dougs_invoice_id"),
    dougsQuoteId: text("dougs_quote_id"),
    dougsReference: text("dougs_reference"),
    dougsStatus: text("dougs_status"),
    dougsTotalHt: numeric("dougs_total_ht", { precision: 12, scale: 2 }),
    dougsTotalVat: numeric("dougs_total_vat", { precision: 12, scale: 2 }),
    dougsTotalTtc: numeric("dougs_total_ttc", { precision: 12, scale: 2 }),
    dougsIssuedAt: timestamp("dougs_issued_at", { withTimezone: true }),
    dougsPaidAt: timestamp("dougs_paid_at", { withTimezone: true }),
    dougsSyncedAt: timestamp("dougs_synced_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    kindIdx: index("invoices_kind_idx").on(t.kind),
    projectIdx: index("invoices_project_idx").on(t.projectId),
    coworkingContractIdx: index("invoices_coworking_contract_idx").on(t.coworkingContractId),
    statusIdx: index("invoices_status_idx").on(t.status),
    dougsInvoiceIdx: index("invoices_dougs_invoice_idx").on(t.dougsInvoiceId),
    dougsQuoteIdx: index("invoices_dougs_quote_idx").on(t.dougsQuoteId),
    cancelsIdx: index("invoices_cancels_idx").on(t.cancelsInvoiceId),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceKind = "quote" | "milestone" | "coworking" | "one_off" | "credit_note";
export type InvoiceStatus = "draft" | "sent" | "accepted" | "refused" | "paid";
export type MilestoneType = "acompte" | "intermediaire" | "solde";
