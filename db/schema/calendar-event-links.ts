import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { googleCalendars } from "./google-calendars";
import { meetings } from "./meetings";
import { projects } from "./projects";
import { timeEntries } from "./time-entries";
import { users } from "./users";

/**
 * Où en est le rattachement d'un rendez-vous Google Calendar à un projet
 * (cf. lib/time/calendar-attach.ts) :
 *  - `suggested` : un projet est reconnu, le créneau n'existe pas encore
 *    (rendez-vous à venir, réglage auto éteint, ou présence non confirmée)
 *  - `applied`   : un créneau réalisé existe, posé sans clic ou à la main
 *  - `dismissed` : l'humain a supprimé le créneau ou refusé : on n'y revient plus
 *  - `unmatched` : évalué, aucun projet ne ressort ; réévalué à chaque relève
 */
export const calendarLinkStatus = pgEnum("calendar_link_status", [
  "suggested",
  "applied",
  "dismissed",
  "unmatched",
]);

/**
 * Trace du rattachement rendez-vous → projet → temps. Table à part de
 * `calendar_events`, que la relève efface et réécrit à chaque passage : ce
 * qu'on a décidé d'un rendez-vous doit survivre au cache. Clé stable :
 * (calendrier, id d'événement Google), la même que `time_entries` utilise
 * pour son miroir.
 *
 * `meeting_id` : la réunion Parade OS (transcript) tenue sur ce créneau,
 * quand on l'a retrouvée. Elle apporte son projet au rendez-vous, ou le
 * reçoit de lui si elle n'en avait pas.
 */
export const calendarEventLinks = pgTable(
  "calendar_event_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleCalendarId: uuid("google_calendar_id")
      .notNull()
      .references(() => googleCalendars.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id").notNull(),
    status: calendarLinkStatus("status").notNull().default("unmatched"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "set null" }),
    /** Score de la décision (cf. lib/time/calendar-signals.ts), null si manuel ou sans projet. */
    score: numeric("score", { precision: 4, scale: 2 }),
    /** Indices retenus (`title_project+attendees (1.4)`), ou `manual`. */
    reasons: text("reasons"),
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id, { onDelete: "set null" }),
    /** Créneau posé sans clic : quand. Null si l'humain l'a créé lui-même. */
    autoAt: timestamp("auto_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    eventUnique: uniqueIndex("calendar_event_links_event_unique").on(
      t.googleCalendarId,
      t.googleEventId,
    ),
    userStatusIdx: index("calendar_event_links_user_status_idx").on(t.userId, t.status),
    timeEntryIdx: index("calendar_event_links_time_entry_idx").on(t.timeEntryId),
    meetingIdx: index("calendar_event_links_meeting_idx").on(t.meetingId),
  }),
);

export type CalendarEventLink = typeof calendarEventLinks.$inferSelect;
export type NewCalendarEventLink = typeof calendarEventLinks.$inferInsert;
export type CalendarLinkStatus = (typeof calendarLinkStatus.enumValues)[number];
