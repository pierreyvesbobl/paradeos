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

/**
 * Dimensions de liaison d'un thread. Ce ne sont PAS des tags au sens
 * d'une taxonomie utilisateur : chaque valeur est la projection d'un
 * fait Paradeos.
 *   - project / contact / entity : liaison CRM, née d'un signal auto ou
 *     d'une décision validée sur une proposition.
 *   - category : réservé aux libellés SYSTÈME (sens de facture), dérivés
 *     de `invoice_filings`. Plus aucune taxonomie libre n'est créable —
 *     les lignes `category` héritées d'avant sont inertes.
 */
export const gmailTagKind = pgEnum("gmail_tag_kind", ["project", "contact", "entity", "category"]);

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
    /**
     * Sortie non-actionnable de l'extraction LLM :
     * `{ summary, intent, pipelineStage, needsReply }`.
     * Les propositions actionnables (task/contact/entity/project/draft_reply)
     * vont dans `emailProposals` séparément.
     */
    extractionMeta: jsonb("extraction_meta"),
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
 * Libellés Paradeos — miroir des labels Gmail. Inclut :
 *   - `project` / `contact` / `entity` : libellés dérivés des records
 *     CRM. `targetId` pointe vers le record.
 *   - `category` : libellés SYSTÈME uniquement (Facture achat / Facture
 *     vente). `targetId` est null. Aucune création libre.
 *
 * `gmailLabelId` est rempli au premier sync ou au premier push. Si
 * null, c'est que le label n'a pas encore été créé côté Gmail.
 */
export const gmailTags = pgTable(
  "gmail_tags",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: gmailTagKind("kind").notNull(),
    targetId: uuid("target_id"),
    labelName: text("label_name").notNull(),
    gmailLabelId: text("gmail_label_id"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    targetUnique: uniqueIndex("gmail_tags_target_unique").on(
      table.userId,
      table.kind,
      table.targetId,
    ),
    labelNameUnique: uniqueIndex("gmail_tags_label_name_unique").on(table.userId, table.labelName),
    userKindIdx: index("gmail_tags_user_kind_idx").on(table.userId, table.kind),
  }),
);

/**
 * Liaison thread × dimension. `source` indique d'où vient l'association :
 *   - `auto` : Paradeos l'a déduite (match contact/entité à la sync)
 *   - `gmail` : remontée du label Gmail (l'utilisateur a rangé dans Gmail)
 *   - `manual` : posée par une décision explicite dans Paradeos
 *
 * Le couple (`manuallyOverridden`, `dismissedAt`) porte la décision
 * humaine, dans les deux sens :
 *   - `manuallyOverridden=true, dismissedAt=null`  → « oui, c'est ce lien »
 *   - `manuallyOverridden=true, dismissedAt=<date>` → « non, pas ce lien »
 *
 * Une ligne invalidée n'est pas supprimée : c'est elle qui scelle le
 * refus. L'index unique (thread, tag) + les inserts `onConflictDoNothing`
 * de l'auto-link empêchent alors de rétablir un lien que l'humain a
 * retiré. Toute lecture de liaison doit filtrer `dismissedAt is null`.
 */
export const gmailThreadTags = pgTable(
  "gmail_thread_tags",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => gmailThreads.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => gmailTags.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("gmail"),
    manuallyOverridden: boolean("manually_overridden").notNull().default(false),
    /** Non-null = liaison invalidée par l'utilisateur (décision négative). */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** Auteur de la dernière décision (validation ou invalidation). */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    unique: uniqueIndex("gmail_thread_tags_unique").on(table.threadId, table.tagId),
    threadIdx: index("gmail_thread_tags_thread_idx").on(table.threadId),
    tagIdx: index("gmail_thread_tags_tag_idx").on(table.tagId),
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

// ─── Phase 2 : propositions LLM extraites des emails matchés ─────────

export const emailProposalKind = pgEnum("email_proposal_kind", [
  "task",
  "category_tag",
  "project_link",
  "entity_link",
  "project_contact_link",
  "contact",
  "entity",
  "project",
  "draft_reply",
]);

export const emailProposalStatus = pgEnum("email_proposal_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const emailProposals = pgTable(
  "email_proposals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: uuid("message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),
    kind: emailProposalKind("kind").notNull(),
    payload: jsonb("payload").notNull(),
    matchedId: uuid("matched_id"),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    status: emailProposalStatus("status").notNull().default("pending"),
    createdEntityId: uuid("created_entity_id"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    messageIdx: index("email_proposals_message_idx").on(table.messageId),
  }),
);

export type EmailProposal = typeof emailProposals.$inferSelect;
export type NewEmailProposal = typeof emailProposals.$inferInsert;

export type GmailThread = typeof gmailThreads.$inferSelect;
export type NewGmailThread = typeof gmailThreads.$inferInsert;
export type GmailMessage = typeof gmailMessages.$inferSelect;
export type NewGmailMessage = typeof gmailMessages.$inferInsert;
export type GmailTag = typeof gmailTags.$inferSelect;
export type NewGmailTag = typeof gmailTags.$inferInsert;
export type GmailThreadTag = typeof gmailThreadTags.$inferSelect;
export type NewGmailThreadTag = typeof gmailThreadTags.$inferInsert;
export type GmailSyncState = typeof gmailSyncState.$inferSelect;
export type NewGmailSyncState = typeof gmailSyncState.$inferInsert;
