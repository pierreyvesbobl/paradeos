import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Tags applicatifs (libellé + couleur optionnelle). Référencés via la
 * table polymorphe `taggings` ci-dessous.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    color: text("color"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    nameUnique: uniqueIndex("tags_name_unique").on(sql`lower(${table.name})`),
  }),
);

/**
 * Lien polymorphe : un tag peut être attaché à n'importe quelle table
 * via le couple (subject_type, subject_id). On ne pose pas de FK sur
 * subject_id (impossible côté Postgres pour du polymorphe propre) ;
 * la cohérence est assurée par les triggers de cleanup côté SQL.
 */
export const taggings = pgTable(
  "taggings",
  {
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tagId, table.subjectType, table.subjectId] }),
    subjectIdx: index("taggings_subject_idx").on(table.subjectType, table.subjectId),
  }),
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Tagging = typeof taggings.$inferSelect;
export type NewTagging = typeof taggings.$inferInsert;
