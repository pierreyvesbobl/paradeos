import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { googleCalendars } from "./google-calendars";
import { projects } from "./projects";
import { tasks } from "./tasks";
import { users } from "./users";

export const timeEntryKind = pgEnum("time_entry_kind", ["planned", "actual"]);

/**
 * D'où vient le créneau :
 *  - manual      : saisi dans /planning ou via `log_time`
 *  - calendar    : miroir d'un event Google Calendar attribué (cf. `attributeCalendarEvent`)
 *  - claude_code : segment de travail poussé par le mod Claude Code (cf. claude-mod/)
 */
export const timeEntrySource = pgEnum("time_entry_source", ["manual", "calendar", "claude_code"]);

/**
 * Créneaux de planification a priori (`planned`) et de réalisation
 * a posteriori (`actual`). Un entry est rattaché à un user (le sien)
 * et optionnellement à une tâche, un projet ou un contact (réunion).
 *
 * `start_at` < `end_at` (validé applicativement et par contrainte CHECK).
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: timeEntryKind("kind").notNull().default("planned"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    title: text("title"),
    description: text("description"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Avant-vente ou delivery : tout est tracké au niveau projet (les
     * anciennes opportunités sont devenues des projects en statut commercial). */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    color: text("color"),
    /** Si non-null, ce time_entry mirror un event Google Calendar attribué
     * à un projet (cf. `attributeCalendarEvent`). Permet de dédupliquer
     * l'affichage dans /planning et de tracer la provenance. Snapshot —
     * pas de re-sync si l'event Google bouge ensuite. */
    googleEventId: text("google_event_id"),
    googleCalendarId: uuid("google_calendar_id").references(() => googleCalendars.id, {
      onDelete: "set null",
    }),
    source: timeEntrySource("source").notNull().default("manual"),
    /** Identifiant côté source, pour écrire de façon idempotente : pour
     * `claude_code`, `<sessionId>:<n° de segment>`. Le mod réécrit le même
     * segment à chaque fin de tour en étendant `end_at`. */
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    userStartIdx: index("time_entries_user_start_idx").on(table.userId, table.startAt),
    /** Agrégats globaux (rapport /temps) filtrent sur start_at seul. */
    startIdx: index("time_entries_start_idx").on(table.startAt),
    kindIdx: index("time_entries_kind_idx").on(table.kind),
    taskIdx: index("time_entries_task_idx").on(table.taskId),
    projectIdx: index("time_entries_project_idx").on(table.projectId),
    /** Upsert des segments Claude Code : un ref par user et par source. */
    sourceRefUnique: uniqueIndex("time_entries_source_ref_unique")
      .on(table.userId, table.source, table.sourceRef)
      .where(sql`${table.sourceRef} is not null`),
  }),
);

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
