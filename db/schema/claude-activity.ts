import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { timeEntries } from "./time-entries";
import { users } from "./users";

/**
 * Segments de présence dans Claude Code, poussés par le mod `claude-mod/`.
 *
 * C'est un **signal d'imputation**, pas un créneau réalisé : il dit où est
 * parti l'effort d'une journée, et l'humain arbitre avec les autres sources
 * (réunions, mails, calendrier) avant de saisir un vrai `time_entry`. D'où
 * la table séparée : aucun agrégat de temps réalisé ne doit le ramasser.
 *
 * `sourceRef` = `<sessionId>:<n° de segment>` ; le mod réécrit le même
 * segment en étendant `endedAt`, l'upsert est idempotent.
 *
 * `timeEntryId` : le créneau réalisé que l'humain a créé à partir de ce
 * segment (cf. `createTimeEntry` avec `claudeSegmentIds`). Tant qu'il est
 * null, le segment est « à imputer » dans la grille de /temps.
 */
export const claudeCodeActivity = pgTable(
  "claude_code_activity",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null si le dépôt n'est rattaché à aucun projet : le signal reste
     * visible dans /temps, avec `remote` pour proposer le rattachement. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** Clé normalisée du dépôt, ou `local/<dossier>` sans git. */
    remote: text("remote"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    sourceRef: text("source_ref").notNull(),
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    sourceRefUnique: uniqueIndex("claude_code_activity_source_ref_unique").on(
      table.userId,
      table.sourceRef,
    ),
    userStartIdx: index("claude_code_activity_user_start_idx").on(table.userId, table.startedAt),
    projectStartIdx: index("claude_code_activity_project_start_idx").on(
      table.projectId,
      table.startedAt,
    ),
    timeEntryIdx: index("claude_code_activity_time_entry_idx").on(table.timeEntryId),
  }),
);

export type ClaudeCodeActivity = typeof claudeCodeActivity.$inferSelect;
export type NewClaudeCodeActivity = typeof claudeCodeActivity.$inferInsert;
