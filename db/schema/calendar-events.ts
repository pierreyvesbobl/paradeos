import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { googleCalendars } from "./google-calendars";

/**
 * Cache des events Google Calendar. Refresh périodique (cron 15 min).
 * Affichés en lecture seule dans `/planning` à côté des time_entries.
 *
 * Conservés en cache pour ne pas re-frapper l'API à chaque rendu de
 * page — la fraîcheur est suffisante pour un planning visuel.
 *
 * `attendees` est stocké brut (jsonb) ; on n'a pas besoin de query
 * dessus en v1.
 */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    googleCalendarId: uuid("google_calendar_id")
      .notNull()
      .references(() => googleCalendars.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id").notNull(),
    icalUid: text("ical_uid"),
    summary: text("summary"),
    description: text("description"),
    location: text("location"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    status: text("status"),
    htmlLink: text("html_link"),
    organizerEmail: text("organizer_email"),
    attendees: jsonb("attendees"),
    recurringEventId: text("recurring_event_id"),
    googleUpdatedAt: timestamp("google_updated_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    calendarEventUnique: uniqueIndex("calendar_events_calendar_event_unique").on(
      t.googleCalendarId,
      t.googleEventId,
    ),
    rangeIdx: index("calendar_events_range_idx").on(t.googleCalendarId, t.startAt, t.endAt),
  }),
);

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
