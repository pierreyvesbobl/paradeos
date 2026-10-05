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
  uniqueIndex,
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
 * Marque commerciale émettrice. Parade SAS est une seule entité juridique
 * (un seul `companyId` Dougs) mais porte trois marques : `parade` (divers),
 * `coworking` et `automato` (prestation client). C'est la clé du registre de
 * templates (`lib/billing/brand-templates.ts`), qui porte les lignes de
 * facture, l'objet, les mentions, le mail d'accompagnement et l'échéance.
 *
 * Pas de table `brands` — choix d'architecture assumé, cf. README.
 * Cf. migration 0073_invoice_brands.
 */
export const invoiceBrand = pgEnum("invoice_brand", ["parade", "coworking", "automato"]);

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
    /** Marque émettrice. Déduite du kind à la création (`brandForInvoice`),
     *  modifiable ensuite — un `one_off` peut relever de n'importe laquelle. */
    brand: invoiceBrand("brand").notNull().default("parade"),

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

    // Relances : due_date posée à invoiced_at + 30j lors du passage à
    // status='sent' (modifiable). last_reminded_at + reminder_count
    // sont mis à jour par l'action markInvoiceReminded.
    dueDate: date("due_date"),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    reminderCount: integer("reminder_count").notNull().default(0),
    // Responsable de la facturation/relance. À la création, on copie
    // projects.owner_id (lead). Pour le coworking sans projet, reste null
    // jusqu'à assignation explicite.
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),

    // Spec milestone
    milestoneType: text("milestone_type"),
    milestonePercent: integer("milestone_percent"),

    // Spec coworking
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    desks: integer("desks"),
    unitPriceHt: numeric("unit_price_ht", { precision: 10, scale: 2 }),
    billedBy: text("billed_by"),

    // Envoi automatique (coworking). `auto_sent_at` rend le cron idempotent ;
    // `auto_send_error` porte le dernier blocage `can-finalize` pour l'afficher
    // dans l'UI plutôt que de réessayer en boucle. Cf. migration 0074.
    autoSentAt: timestamp("auto_sent_at", { withTimezone: true }),
    autoSendError: text("auto_send_error"),

    // Classement du PDF dans le Drive comptable. `drive_file_id` non nul
    // signifie « déjà classée » et sert de verrou d'idempotence.
    // Cf. migration 0078.
    driveFileId: text("drive_file_id"),
    driveFiledAt: timestamp("drive_filed_at", { withTimezone: true }),
    driveFilingError: text("drive_filing_error"),

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
    brandIdx: index("invoices_brand_idx").on(t.brand),
    projectIdx: index("invoices_project_idx").on(t.projectId),
    coworkingContractIdx: index("invoices_coworking_contract_idx").on(t.coworkingContractId),
    statusIdx: index("invoices_status_idx").on(t.status),
    dougsInvoiceIdx: index("invoices_dougs_invoice_idx").on(t.dougsInvoiceId),
    dougsQuoteIdx: index("invoices_dougs_quote_idx").on(t.dougsQuoteId),
    cancelsIdx: index("invoices_cancels_idx").on(t.cancelsInvoiceId),
    dueDateIdx: index("invoices_due_date_idx").on(t.dueDate).where(sql`status = 'sent'`),
    assignedToIdx: index("invoices_assigned_to_idx").on(t.assignedTo).where(sql`status = 'sent'`),
    /** Une facture coworking par contrat et par période (cron vs bouton). */
    coworkingPeriodUidx: uniqueIndex("invoices_coworking_period_uidx")
      .on(t.coworkingContractId, t.periodStart)
      .where(sql`kind = 'coworking' and coworking_contract_id is not null`),
    /** Factures émises dont le PDF n'est pas encore dans le Drive. */
    driveFilingQueueIdx: index("invoices_drive_filing_queue_idx")
      .on(t.invoicedAt)
      .where(sql`drive_file_id is null and status in ('sent', 'paid')`),
    /** File d'attente de la passe d'envoi auto du cron coworking. */
    coworkingAutoSendQueueIdx: index("invoices_coworking_autosend_queue_idx")
      .on(t.coworkingContractId)
      .where(sql`kind = 'coworking' and status = 'draft' and auto_sent_at is null`),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceKind = "quote" | "milestone" | "coworking" | "one_off" | "credit_note";
export type InvoiceBrand = "parade" | "coworking" | "automato";
export type InvoiceStatus = "draft" | "sent" | "accepted" | "refused" | "paid";
export type MilestoneType = "acompte" | "intermediaire" | "solde";
