import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { invoiceFilings } from "./invoice-filings";
import { users } from "./users";

/**
 * Qui a déposé le PDF dans le Drive. `parade_os` = notre chaîne de
 * classement Gmail (on connaît alors le `invoice_filing_id`), `legacy` =
 * l'automatisation antérieure, encore active, qui dépose ses propres
 * fichiers hors de l'app.
 */
export const purchaseDocumentSource = pgEnum("purchase_document_source", ["parade_os", "legacy"]);

/**
 * État de la capture des montants. C'est une file d'attente : le cron
 * draine les `pending` par lots. `unparseable` = PDF sans couche texte
 * (scan), qu'il est inutile de repasser au LLM à chaque run.
 */
export const purchaseExtractionStatus = pgEnum("purchase_extraction_status", [
  "pending",
  "done",
  "failed",
  "unparseable",
]);

/**
 * Inventaire des factures d'achat présentes dans le Drive comptable.
 *
 * Miroir du dossier, pas de la boîte mail : une ligne par fichier trouvé
 * sous le dossier racine, quelle que soit la chaîne qui l'y a mis. C'est
 * ce qui permet de rapprocher aussi les factures déposées par l'ancienne
 * automatisation, invisibles de `invoice_filings`.
 */
export const purchaseDocuments = pgTable(
  "purchase_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /**
     * Compte au nom duquel le Drive a été lu. Ne partitionne PAS les
     * données : le dossier comptable est unique pour l'entreprise, et
     * `drive_file_id` est unique globalement. Toute requête d'inventaire
     * doit donc ignorer cette colonne.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Identité du document : un fichier Drive, une ligne. */
    driveFileId: text("drive_file_id").notNull(),
    driveFileName: text("drive_file_name").notNull(),
    /** Empreinte Drive du binaire — repère les doublons entre dossiers. */
    driveMd5: text("drive_md5"),
    sizeBytes: integer("size_bytes"),
    driveCreatedAt: timestamp("drive_created_at", { withTimezone: true }),
    webViewLink: text("web_view_link"),

    /** Nom lisible du fournisseur, tel qu'il apparaît dans le Drive. */
    supplierLabel: text("supplier_label"),
    /** `normalizeSupplierKey(supplierLabel)` — la clé de rapprochement. */
    supplierKey: text("supplier_key"),
    invoiceDate: date("invoice_date"),

    amountTtc: numeric("amount_ttc", { precision: 12, scale: 2 }),
    amountHt: numeric("amount_ht", { precision: 12, scale: 2 }),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
    currency: text("currency"),
    invoiceNumber: text("invoice_number"),

    source: purchaseDocumentSource("source").notNull().default("legacy"),
    invoiceFilingId: uuid("invoice_filing_id").references(() => invoiceFilings.id, {
      onDelete: "set null",
    }),

    extractionStatus: purchaseExtractionStatus("extraction_status").notNull().default("pending"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    /** Passages LLM déjà tentés — borne les réessais sur erreur transitoire. */
    extractionAttempts: integer("extraction_attempts").notNull().default(0),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    driveFileUnique: uniqueIndex("purchase_documents_drive_file_unique").on(table.driveFileId),
    supplierIdx: index("purchase_documents_supplier_idx").on(table.supplierKey, table.invoiceDate),
    amountIdx: index("purchase_documents_amount_idx").on(table.amountTtc),
    extractionQueueIdx: index("purchase_documents_extraction_idx").on(
      table.extractionStatus,
      table.extractedAt,
    ),
  }),
);

/**
 * Snapshot des opérations bancaires Dougs.
 *
 * On copie plutôt que de lire en direct à chaque rendu : le cron a besoin
 * des opérations hors requête utilisateur, la file de validation a besoin
 * de lignes stables sur lesquelles accrocher une décision, et Dougs — API
 * interne derrière Cloudflare, cookie qui meurt toutes les 24 h — ne doit
 * jamais être un point de défaillance de la page.
 */
export const dougsOperations = pgTable(
  "dougs_operations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    dougsOperationId: bigint("dougs_operation_id", { mode: "number" }).notNull(),
    operationDate: date("operation_date"),
    /** Montant signé tel que Dougs le renvoie : négatif = décaissement. */
    amount: numeric("amount", { precision: 12, scale: 2 }),
    /** Libellé bancaire brut, souvent bruité (« PRLV SEPA OVH SAS 1234 »). */
    wording: text("wording"),
    isInbound: boolean("is_inbound"),
    validated: boolean("validated").notNull().default(false),
    attachmentCount: integer("attachment_count").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().default(sql`now()`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    operationUnique: uniqueIndex("dougs_operations_operation_unique").on(
      table.userId,
      table.dougsOperationId,
    ),
    orphanIdx: index("dougs_operations_orphan_idx").on(
      table.userId,
      table.attachmentCount,
      table.operationDate,
    ),
  }),
);

/** Niveau de certitude — seul `certain` autorise un attachement automatique. */
export const dougsMatchConfidence = pgEnum("dougs_match_confidence", ["certain", "probable"]);

export const dougsMatchStatus = pgEnum("dougs_match_status", [
  "suggested",
  "attached",
  "rejected",
  "failed",
]);

/**
 * Rapprochement entre une opération bancaire et un PDF du Drive.
 *
 * L'unicité porte sur le couple (opération, document) et surtout pas sur
 * le document seul : une facture de loyer trimestrielle doit pouvoir être
 * attachée aux trois prélèvements mensuels qu'elle couvre.
 */
export const dougsOperationMatches = pgTable(
  "dougs_operation_matches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => dougsOperations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => purchaseDocuments.id, { onDelete: "cascade" }),

    score: numeric("score", { precision: 4, scale: 3 }),
    /** Sous-scores montant/fournisseur/date, conservés pour expliquer un match. */
    scoreBreakdown: jsonb("score_breakdown"),
    confidence: dougsMatchConfidence("confidence").notNull().default("probable"),
    status: dougsMatchStatus("status").notNull().default("suggested"),

    /** Renvoyé par Dougs à l'upload — c'est ce qui rend « Détacher » possible. */
    dougsAttachmentId: text("dougs_attachment_id"),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    pairUnique: uniqueIndex("dougs_operation_matches_pair_unique").on(
      table.operationId,
      table.documentId,
    ),
    queueIdx: index("dougs_operation_matches_queue_idx").on(
      table.userId,
      table.status,
      table.score,
    ),
  }),
);

export type PurchaseDocument = typeof purchaseDocuments.$inferSelect;
export type NewPurchaseDocument = typeof purchaseDocuments.$inferInsert;
export type DougsOperation = typeof dougsOperations.$inferSelect;
export type NewDougsOperation = typeof dougsOperations.$inferInsert;
export type DougsOperationMatch = typeof dougsOperationMatches.$inferSelect;
export type NewDougsOperationMatch = typeof dougsOperationMatches.$inferInsert;
