import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { googleAccounts } from "./google-accounts";

/**
 * Calendriers Google de l'utilisateur (synchronisés depuis l'API
 * `calendarList`). Pour chacun, l'user choisit s'il l'affiche dans
 * `/planning` (`sync_enabled`).
 *
 * `sync_token` est conservé pour pouvoir basculer plus tard sur un
 * sync incrémental (events.list?syncToken=…). En v1 on fait des refresh
 * complets de la fenêtre [now, +30 jours], c'est simple et suffisant
 * pour les volumes typiques.
 */
export const googleCalendars = pgTable(
  "google_calendars",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    googleAccountId: uuid("google_account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    summary: text("summary").notNull(),
    description: text("description"),
    isPrimary: boolean("is_primary").notNull().default(false),
    backgroundColor: text("background_color"),
    foregroundColor: text("foreground_color"),
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    syncToken: text("sync_token"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    accountCalendarUnique: uniqueIndex("google_calendars_account_calendar_unique").on(
      t.googleAccountId,
      t.calendarId,
    ),
  }),
);

export type GoogleCalendar = typeof googleCalendars.$inferSelect;
export type NewGoogleCalendar = typeof googleCalendars.$inferInsert;
