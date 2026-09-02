import { sql } from "drizzle-orm";
import {
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gmailMessages } from "./gmail";
import { users } from "./users";

export const invoiceFilingStatus = pgEnum("invoice_filing_status", [
  "pending",
  "filed",
  "rejected",
  "error",
]);

/**
 * Sens de la facture, du point de vue de Parade :
 *   - `purchase` : facture d'ACHAT (fournisseur) — à classer dans Drive.
 *   - `sale`     : facture de VENTE émise par Parade et reçue en copie
 *                  (BCC compta, renvoi client, notification Dougs). On la
 *                  détecte et on la tague, mais on ne la classe pas ici :
 *                  elle est déjà gérée via le rapprochement Dougs.
 *   - `unknown`  : pas encore classifié, ou PJ qui n'est pas une facture.
 */
export const invoiceFilingDirection = pgEnum("invoice_filing_direction", [
  "purchase",
  "sale",
  "unknown",
]);

/**
 * Audit log de l'agent de détection/classement des factures reçues par mail.
 * Couvre les deux sens : achats (classés dans Drive) et ventes (détectées et
 * taguées, mais non classées — cf. `direction`).
 * Une ligne par PJ traitée. Idempotence : (message_id, gmail_attachment_id)
 * unique → relancer un sync ne reclasse pas un PDF déjà filé.
 */
export const invoiceFilings = pgTable(
  "invoice_filings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),
    gmailAttachmentId: text("gmail_attachment_id").notNull(),
    originalFilename: text("original_filename"),
    /** Achat / vente / non classifié — cf. `invoiceFilingDirection`. */
    direction: invoiceFilingDirection("direction").notNull().default("unknown"),
    invoiceDate: date("invoice_date"),
    supplierRaw: text("supplier_raw"),
    supplierSanitized: text("supplier_sanitized"),
    /** Destinataire de la facture — rempli côté vente (le client). */
    customerRaw: text("customer_raw"),
    prestationType: text("prestation_type"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    generatedFilename: text("generated_filename"),
    driveYearFolderId: text("drive_year_folder_id"),
    driveSupplierFolderId: text("drive_supplier_folder_id"),
    driveFileId: text("drive_file_id"),
    status: invoiceFilingStatus("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    messageAttachmentUnique: uniqueIndex("invoice_filings_message_attachment_unique").on(
      table.messageId,
      table.gmailAttachmentId,
    ),
    userStatusIdx: index("invoice_filings_user_status_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    userDirectionIdx: index("invoice_filings_user_direction_idx").on(
      table.userId,
      table.direction,
      table.createdAt,
    ),
  }),
);

export type InvoiceFiling = typeof invoiceFilings.$inferSelect;
export type NewInvoiceFiling = typeof invoiceFilings.$inferInsert;
