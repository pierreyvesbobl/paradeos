import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Réglages applicatifs sensibles (clés API tierces, toggles globaux).
 * Stockage clé/valeur, accès strictement admin via RLS — voir migration
 * Supabase associée.
 *
 * Conventions de clés :
 *   - `OPENAI_API_KEY` : clé API OpenAI utilisée par le pipeline meetings.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type AppSetting = typeof appSettings.$inferSelect;
