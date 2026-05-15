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
