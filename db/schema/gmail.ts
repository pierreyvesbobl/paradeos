import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { users } from "./users";

export const gmailExtractionStatus = pgEnum("gmail_extraction_status", [
  "skipped", // métadonnées seulement (pas de match CRM)
  "pending", // body stocké, en attente d'extraction LLM
  "extracted",
  "failed",
]);

export const gmailLinkKind = pgEnum("gmail_link_kind", ["project", "contact", "entity"]);

export const gmailLinkSource = pgEnum("gmail_link_source", [
  "auto_contact", // sender/recipient = contact CRM
  "auto_llm", // proposition LLM acceptée
  "manual",
]);

/**
 * Threads Gmail — agrégat dénormalisé pour l'UI (timeline contact /
 * projet / entité). Une ligne par `gmail_thread_id` × `user_id`.
 */
export const gmailThreads = pgTable(
  "gmail_threads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject"),
    /** Array `{ email, name? }` agrégé sur tous les messages du thread. */
    participants: jsonb("participants").notNull().default(sql`'[]'::jsonb`),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    snippet: text("snippet"),
    messageCount: integer("message_count").notNull().default(0),
    hasUnread: boolean("has_unread").notNull().default(false),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    userThreadUnique: uniqueIndex("gmail_threads_user_thread_unique").on(
      table.userId,
      table.gmailThreadId,
    ),
    userLastMsgIdx: index("gmail_threads_user_last_msg_idx").on(table.userId, table.lastMessageAt),
  }),
);

/**
 * Messages Gmail. `body_text` et `body_html` sont nullables : on ne
 * stocke le contenu complet que pour les emails matchés CRM (cf.
 * `extraction_status != 'skipped'`).
 */
export const gmailMessages = pgTable(
  "gmail_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => gmailThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    toEmails: text("to_emails").array().notNull().default(sql`'{}'::text[]`),
    ccEmails: text("cc_emails").array().notNull().default(sql`'{}'::text[]`),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    internalDate: timestamp("internal_date", { withTimezone: true }),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    isDraft: boolean("is_draft").notNull().default(false),
    extractionStatus: gmailExtractionStatus("extraction_status").notNull().default("skipped"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    userMsgUnique: uniqueIndex("gmail_messages_user_msg_unique").on(
      table.userId,
      table.gmailMessageId,
    ),
    threadDateIdx: index("gmail_messages_thread_date_idx").on(table.threadId, table.internalDate),
  }),
);

/**
 * Liens polymorphes thread → sujet CRM. Pas de FK sur `linkId`
 * (polymorphe) — la cohérence est gérée côté app.
 */
export const gmailLinks = pgTable(
  "gmail_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => gmailThreads.id, { onDelete: "cascade" }),
    linkKind: gmailLinkKind("link_kind").notNull(),
    linkId: uuid("link_id").notNull(),
    source: gmailLinkSource("source").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    unique: uniqueIndex("gmail_links_unique").on(table.threadId, table.linkKind, table.linkId),
    threadIdx: index("gmail_links_thread_idx").on(table.threadId),
    targetIdx: index("gmail_links_target_idx").on(table.linkKind, table.linkId),
  }),
);

/**
 * État de sync Gmail par utilisateur. `lastHistoryId` est le cursor de
 * la Gmail History API pour la sync incrémentale. `bootstrapCursor` est
 * le pageToken pendant le bootstrap initial (3 derniers mois) qui peut
 * s'étaler sur plusieurs runs cron.
 */
export const gmailSyncState = pgTable("gmail_sync_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastHistoryId: bigint("last_history_id", { mode: "number" }),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
  lastIncrementalAt: timestamp("last_incremental_at", { withTimezone: true }),
  bootstrapCursor: text("bootstrap_cursor"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type GmailThread = typeof gmailThreads.$inferSelect;
export type NewGmailThread = typeof gmailThreads.$inferInsert;
export type GmailMessage = typeof gmailMessages.$inferSelect;
export type NewGmailMessage = typeof gmailMessages.$inferInsert;
export type GmailLink = typeof gmailLinks.$inferSelect;
export type NewGmailLink = typeof gmailLinks.$inferInsert;
export type GmailSyncState = typeof gmailSyncState.$inferSelect;
export type NewGmailSyncState = typeof gmailSyncState.$inferInsert;
