import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Compte Google OAuth connecté par un user Paradeos. En v1, un seul
 * compte par user (`UNIQUE user_id`). Donne accès à Drive (scope
 * `drive.file` — fichiers explicitement choisis via le Picker) et,
 * plus tard, Gmail / Calendar via scopes incrémentaux.
 *
 * Les tokens sont chiffrés AES-GCM côté app (cf. lib/crypto/secrets.ts)
 * — le `refresh_token` étant long-lived, on ne veut pas qu'un dump
 * Postgres suffise à pivoter sur le Drive de l'user.
 *
 * `revoked_at` permet une suppression soft suivie d'un cleanup ; en
 * pratique on hard-delete au disconnect (cf. route disconnect).
 */
export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleSub: text("google_sub").notNull(),
    email: text("email").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scopes: text("scopes").array().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    userIdUnique: uniqueIndex("google_accounts_user_id_unique").on(t.userId),
  }),
);

export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type NewGoogleAccount = typeof googleAccounts.$inferInsert;
