import { sql } from "drizzle-orm";
import {
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
import { contacts } from "./contacts";
import { users } from "./users";

/**
 * LinkedIn — conversations (DM), messages et relations.
 *
 * Particularité par rapport à Gmail : Paradeos n'appelle JAMAIS LinkedIn.
 * LinkedIn n'expose ni les DM ni les relations via son API self-serve, et
 * bloque les IP datacenter (Vercel tourne sur AWS) ; pire, réutiliser le
 * même cookie de session depuis une IP résidentielle ET depuis Vercel est
 * le signal exact qui fait restreindre un compte.
 *
 * C'est donc l'extension Chrome qui appelle l'API interne Voyager depuis
 * le navigateur de l'utilisateur, puis pousse le JSON déjà normalisé sur
 * POST /api/linkedin/ingest. Conséquence : aucun cookie `li_at` n'est
 * stocké ici — il ne quitte jamais la machine.
 */

/** Sens du message, du point de vue du propriétaire de la boîte. */
export const linkedinDirection = pgEnum("linkedin_direction", ["in", "out"]);

/** Aligné sur `gmail_extraction_status` — même pipeline d'extraction LLM. */
export const linkedinExtractionStatus = pgEnum("linkedin_extraction_status", [
  "skipped",
  "pending",
  "extracted",
  "failed",
]);

/** Dimensions CRM rattachables à une conversation. */
export const linkedinLinkKind = pgEnum("linkedin_link_kind", ["project", "contact", "entity"]);

/** État d'une relation LinkedIn face au CRM (cf. linkedinConnections). */
export const linkedinMatchStatus = pgEnum("linkedin_match_status", [
  "auto_merged",
  "pending",
  "created",
  "ignored",
]);

export const linkedinProposalStatus = pgEnum("linkedin_proposal_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const linkedinProposalKind = pgEnum("linkedin_proposal_kind", [
  "task",
  "contact",
  "entity",
  "project_link",
  "entity_link",
]);

/**
 * Tokens utilisés par l'extension Chrome pour pousser les données
 * LinkedIn. Même primitive que `dougs_sync_tokens` : token brut affiché
 * une seule fois, stocké en SHA-256, révocable.
 *
 * Table distincte plutôt qu'une table générique `service_sync_tokens` :
 * la synchro Dougs fonctionne, on ne la touche pas pour une factorisation
 * de soixante lignes. À fusionner le jour où un 3e service arrive.
 */
export const linkedinSyncTokens = pgTable(
  "linkedin_sync_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex("linkedin_sync_tokens_token_hash_unique").on(t.tokenHash),
    userIdx: index("linkedin_sync_tokens_user_idx").on(t.userId),
  }),
);

export type LinkedinSyncToken = typeof linkedinSyncTokens.$inferSelect;

/**
 * Un participant de conversation tel que l'extension le remonte. Le
 * `publicIdentifier` (le slug de linkedin.com/in/<slug>) est la clé de
 * rapprochement avec `contacts.linkedin_url` — un DM n'a pas d'email,
 * donc pas de clé aussi solide que côté Gmail.
 */
export type LinkedinParticipant = {
  urn: string;
  name: string | null;
  headline: string | null;
  publicIdentifier: string | null;
  pictureUrl: string | null;
};

/** Agrégat dénormalisé pour l'UI, miroir de `gmail_threads`. */
export const linkedinConversations = pgTable(
  "linkedin_conversations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationUrn: text("conversation_urn").notNull(),
    title: text("title"),
    participants: jsonb("participants").$type<LinkedinParticipant[]>().notNull().default([]),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    snippet: text("snippet"),
    messageCount: integer("message_count").notNull().default(0),
    isGroup: boolean("is_group").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    convUnique: uniqueIndex("linkedin_conversations_user_urn_unique").on(
      t.userId,
      t.conversationUrn,
    ),
    lastMsgIdx: index("linkedin_conversations_user_last_msg_idx").on(t.userId, t.lastMessageAt),
  }),
);

export type LinkedinConversation = typeof linkedinConversations.$inferSelect;
export type NewLinkedinConversation = typeof linkedinConversations.$inferInsert;

/**
 * `bodyText` est nullable pour la même raison que `gmail_messages` : on
 * ne stocke le contenu que si la conversation matche le CRM. Le reste
 * n'est indexé qu'en métadonnées.
 */
export const linkedinMessages = pgTable(
  "linkedin_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => linkedinConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageUrn: text("message_urn").notNull(),
    senderUrn: text("sender_urn"),
    senderName: text("sender_name"),
    senderPublicIdentifier: text("sender_public_identifier"),
    direction: linkedinDirection("direction").notNull().default("in"),
    bodyText: text("body_text"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    extractionStatus: linkedinExtractionStatus("extraction_status").notNull().default("skipped"),
    extractionMeta: jsonb("extraction_meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    msgUnique: uniqueIndex("linkedin_messages_user_urn_unique").on(t.userId, t.messageUrn),
    convDateIdx: index("linkedin_messages_conv_date_idx").on(t.conversationId, t.sentAt),
  }),
);

export type LinkedinMessage = typeof linkedinMessages.$inferSelect;
export type NewLinkedinMessage = typeof linkedinMessages.$inferInsert;

/**
 * Rattachement d'une conversation à une dimension CRM.
 *
 * On pointe directement le target (kind + target_id), sans table
 * intermédiaire à la `gmail_tags` : cette indirection n'existe côté
 * Gmail que pour porter `label_name` / `gmail_label_id`, le miroir d'un
 * libellé Gmail. LinkedIn n'a pas de libellés, donc pas d'indirection.
 *
 * En revanche on conserve intégralement la sémantique de décision du
 * refactor « rattachements » :
 *  - `manuallyOverridden=true, dismissedAt=null`  → « oui, c'est ce lien »
 *  - `manuallyOverridden=true, dismissedAt=<date>` → « non, pas ce lien »
 * La ligne n'est JAMAIS supprimée : c'est elle qui scelle le refus et
 * empêche l'auto-link de reposer la liaison (insert onConflictDoNothing).
 * Toute lecture de liaison doit filtrer `dismissedAt is null`.
 */
export const linkedinConversationLinks = pgTable(
  "linkedin_conversation_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => linkedinConversations.id, { onDelete: "cascade" }),
    kind: linkedinLinkKind("kind").notNull(),
    targetId: uuid("target_id").notNull(),
    source: text("source").notNull().default("auto"),
    manuallyOverridden: boolean("manually_overridden").notNull().default(false),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    linkUnique: uniqueIndex("linkedin_conversation_links_unique").on(
      t.conversationId,
      t.kind,
      t.targetId,
    ),
    convIdx: index("linkedin_conversation_links_conv_idx").on(t.conversationId),
  }),
);

export type LinkedinConversationLink = typeof linkedinConversationLinks.$inferSelect;

/**
 * Relations LinkedIn importées. Cette table est à la fois le staging de
 * l'import ET la file de rapprochement — pas deux tables : une relation
 * en `match_status='pending'` est exactement une ligne de la file.
 *
 * `email` est presque toujours null (LinkedIn ne l'expose pas dans la
 * liste de relations), d'où le besoin de la file.
 */
export const linkedinConnections = pgTable(
  "linkedin_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberUrn: text("member_urn").notNull(),
    publicIdentifier: text("public_identifier"),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    headline: text("headline"),
    company: text("company"),
    position: text("position"),
    profileUrl: text("profile_url"),
    email: text("email"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    matchedContactId: uuid("matched_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    matchStatus: linkedinMatchStatus("match_status").notNull().default("pending"),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    memberUnique: uniqueIndex("linkedin_connections_user_member_unique").on(t.userId, t.memberUrn),
    statusIdx: index("linkedin_connections_status_idx").on(t.userId, t.matchStatus),
  }),
);

export type LinkedinConnection = typeof linkedinConnections.$inferSelect;
export type NewLinkedinConnection = typeof linkedinConnections.$inferInsert;

/**
 * Curseurs de synchro. Pas de `last_history_id` façon Gmail : Voyager
 * n'expose pas d'API d'historique, la synchro repart des conversations
 * les plus récentes et s'arrête dès qu'elle retombe sur du déjà-vu.
 */
export const linkedinSyncState = pgTable("linkedin_sync_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastConversationsSyncAt: timestamp("last_conversations_sync_at", { withTimezone: true }),
  lastConnectionsSyncAt: timestamp("last_connections_sync_at", { withTimezone: true }),
  conversationsCursor: text("conversations_cursor"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type LinkedinSyncState = typeof linkedinSyncState.$inferSelect;

/** Miroir de `email_proposals` — extractions LLM à valider dans l'inbox. */
export const linkedinProposals = pgTable(
  "linkedin_proposals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: uuid("message_id")
      .notNull()
      .references(() => linkedinMessages.id, { onDelete: "cascade" }),
    kind: linkedinProposalKind("kind").notNull(),
    payload: jsonb("payload").notNull(),
    /** Polymorphe (contact / entité / projet) — volontairement sans FK. */
    matchedId: uuid("matched_id"),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    status: linkedinProposalStatus("status").notNull().default("pending"),
    createdEntityId: uuid("created_entity_id"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    messageIdx: index("linkedin_proposals_message_idx").on(t.messageId),
  }),
);

export type LinkedinProposal = typeof linkedinProposals.$inferSelect;
