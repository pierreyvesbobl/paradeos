import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { projects } from "./projects";
import { tasks } from "./tasks";
import { users } from "./users";

export const timeEntryKind = pgEnum("time_entry_kind", ["planned", "actual"]);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    userStartIdx: index("time_entries_user_start_idx").on(table.userId, table.startAt),
    kindIdx: index("time_entries_kind_idx").on(table.kind),
    taskIdx: index("time_entries_task_idx").on(table.taskId),
    projectIdx: index("time_entries_project_idx").on(table.projectId),
  }),
);

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
