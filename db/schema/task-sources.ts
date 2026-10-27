import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gmailMessages } from "./gmail";
import { meetings } from "./meetings";
import { tasks } from "./tasks";

export const taskSourceKind = pgEnum("task_source_kind", ["meeting", "email"]);

/**
 *  - `origin`     : la tâche a été créée d'après ce passage ;
 *  - `mention`    : déjà ouverte, elle est réévoquée (précision, relance,
 *                   contrainte nouvelle) ;
 *  - `completion` : le passage la donne pour faite (evidence d'une
 *                   proposition `task_completion`).
 */
export const taskSourceRelation = pgEnum("task_source_relation", [
  "origin",
  "mention",
  "completion",
]);

/**
 * Ce qui a été dit d'une tâche, mot pour mot, dans les réunions et les
 * mails. Une tâche née d'une extraction ne gardait que son titre ; ici
 * s'accumulent les passages verbatim, datés par leur source et attribués
 * à qui parle, pour qu'un brief (fiche tâche, issue GitHub) les restitue
 * sans relire les transcripts.
 *
 * Une ligne pointe soit une réunion, soit un message Gmail (check en
 * base). L'empreinte du passage (`excerptFingerprint`, cf.
 * lib/tasks/task-sources.ts) rend les ré-extractions idempotentes.
 */
export const taskSources = pgTable(
  "task_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sourceKind: taskSourceKind("source_kind").notNull(),
    meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => gmailMessages.id, { onDelete: "cascade" }),
    relation: taskSourceRelation("relation").notNull(),
    /** Passage verbatim, tel que le transcript ou le mail le porte. */
    excerpt: text("excerpt").notNull(),
    /** Qui parle, si la source le dit. */
    speaker: text("speaker"),
    excerptFingerprint: text("excerpt_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    taskIdx: index("task_sources_task_idx").on(table.taskId),
    meetingIdx: index("task_sources_meeting_idx")
      .on(table.meetingId)
      .where(sql`${table.meetingId} is not null`),
    messageIdx: index("task_sources_message_idx")
      .on(table.messageId)
      .where(sql`${table.messageId} is not null`),
    meetingExcerptUnique: uniqueIndex("task_sources_meeting_excerpt_unique")
      .on(table.taskId, table.meetingId, table.excerptFingerprint)
      .where(sql`${table.meetingId} is not null`),
    messageExcerptUnique: uniqueIndex("task_sources_message_excerpt_unique")
      .on(table.taskId, table.messageId, table.excerptFingerprint)
      .where(sql`${table.messageId} is not null`),
    oneSource: check(
      "task_sources_one_source",
      sql`(${table.sourceKind} = 'meeting' and ${table.meetingId} is not null and ${table.messageId} is null) or (${table.sourceKind} = 'email' and ${table.messageId} is not null and ${table.meetingId} is null)`,
    ),
  }),
);

export type TaskSource = typeof taskSources.$inferSelect;
export type NewTaskSource = typeof taskSources.$inferInsert;
