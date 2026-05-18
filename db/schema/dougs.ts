import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Session Dougs par user. Stocke le cookie chiffré qui sert à appeler
 * l'API interne app.dougs.fr server-to-server. Une seule session active
 * par user (cf. unique index user_id).
 */
export const dougsSessions = pgTable("dougs_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  cookieEncrypted: text("cookie_encrypted").notNull(),
  companyId: text("company_id").notNull().default("107610"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type DougsSession = typeof dougsSessions.$inferSelect;
export type NewDougsSession = typeof dougsSessions.$inferInsert;

/**
 * Tokens utilisés par l'extension Chrome "Paradeos Dougs Sync" pour
 * pousser le cookie de session depuis app.dougs.fr sans copier-coller.
 * Scopés à un seul endpoint (POST /api/dougs/sync-cookie). Token brut
 * affiché une fois, stocké en SHA-256.
 */
export const dougsSyncTokens = pgTable(
  "dougs_sync_tokens",
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
    tokenHashUnique: uniqueIndex("dougs_sync_tokens_token_hash_unique").on(t.tokenHash),
    userIdx: index("dougs_sync_tokens_user_idx").on(t.userId),
  }),
);

export type DougsSyncToken = typeof dougsSyncTokens.$inferSelect;

/**
 * Lien entre une facture d'avoir Dougs (montant négatif) et la facture
 * Dougs qu'elle annule. Permet à la page rapprochement de classer les
 * avoirs séparément des factures et de signaler qu'un avoir est rattaché.
 * Une avoir → au plus une facture d'origine (unique index).
 */
export const dougsCreditNoteLinks = pgTable(
  "dougs_credit_note_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    dougsCreditNoteId: text("dougs_credit_note_id").notNull(),
    cancelsDougsInvoiceId: text("cancels_dougs_invoice_id").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    creditNoteUnique: uniqueIndex("dougs_credit_note_links_cn_unique").on(t.dougsCreditNoteId),
    invoiceIdx: index("dougs_credit_note_links_invoice_idx").on(t.cancelsDougsInvoiceId),
  }),
);

export type DougsCreditNoteLink = typeof dougsCreditNoteLinks.$inferSelect;
export type NewDougsCreditNoteLink = typeof dougsCreditNoteLinks.$inferInsert;
