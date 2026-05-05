import { sql } from "drizzle-orm";
import { numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "member", "viewer"]);

/**
 * Profils applicatifs. `id` référence `auth.users(id)` côté Supabase.
 * Le lien et la création initiale sont gérés par un trigger SQL
 * `handle_new_user` (cf. supabase/migrations).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  role: userRole("role").notNull().default("member"),
  /**
   * Coût interne €HT/heure utilisé pour calculer la rentabilité projet
   * (chargement employeur, prorata frais fixes…). NULL = non renseigné,
   * traité comme 0€/h dans les agrégats.
   */
  costRateHourly: numeric("cost_rate_hourly", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
