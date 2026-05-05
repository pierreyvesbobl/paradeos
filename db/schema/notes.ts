import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const noteSubjectType = pgEnum("note_subject_type", [
  "entity",
  "contact",
  "opportunity",
  "project",
  "task",
]);

export const noteKind = pgEnum("note_kind", ["memo", "call", "meeting", "message"]);

/**
 * Notes polymorphes : compte-rendu, mémo, point de contact, etc.
 * Rattachables à n'importe quel sujet via (subject_type, subject_id),
 * ou laissées "libres" (subject_type/id NULL) pour un carnet de bord.
 *
 * `occurred_at` est la date métier (ex. date de la réunion), `created_at`
 * la date d'enregistrement applicative.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title"),
    content: text("content").notNull(),
    kind: noteKind("kind").notNull().default("memo"),
    subjectType: noteSubjectType("subject_type"),
    subjectId: uuid("subject_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    subjectIdx: index("notes_subject_idx").on(table.subjectType, table.subjectId),
    authorIdx: index("notes_author_idx").on(table.authorId),
    occurredIdx: index("notes_occurred_idx").on(table.occurredAt),
  }),
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
