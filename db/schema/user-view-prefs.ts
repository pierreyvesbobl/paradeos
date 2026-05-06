import { sql } from "drizzle-orm";
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Préférences d'affichage par utilisateur et par page (filtres, tris,
 * recherche). Stockées comme querystring sérialisée pour rester
 * agnostique à la forme exacte des paramètres URL.
 *
 * Synchronisées depuis le client en debounce 500ms à chaque changement
 * d'URL, et lues côté serveur sur le rendu initial pour rediriger vers
 * les paramètres mémorisés (cf. lib/view-prefs/apply.ts).
 */
export const userViewPrefs = pgTable(
  "user_view_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageKey: text("page_key").notNull(),
    /** Querystring brute sans le `?` initial. Vide = pas de préférence. */
    params: text("params").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.pageKey] }),
  }),
);

export type UserViewPref = typeof userViewPrefs.$inferSelect;
