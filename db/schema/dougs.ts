import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
