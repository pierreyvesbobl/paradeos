import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tasks } from "./tasks";

/**
 * L'issue GitHub qui matérialise une tâche (projection à sens unique,
 * cf. lib/github/project-issue.ts). Une issue au plus par tâche.
 * `bodyFingerprint` : empreinte du corps poussé, pour ne réécrire l'issue
 * que si le brief a changé.
 */
export const taskGithubIssues = pgTable(
  "task_github_issues",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** Remote normalisé (`github.com/owner/repo`), cf. lib/git/remote.ts. */
    remote: text("remote").notNull(),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    bodyFingerprint: text("body_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    remoteNumberUnique: uniqueIndex("task_github_issues_remote_number_unique").on(
      table.remote,
      table.number,
    ),
  }),
);

export type TaskGithubIssue = typeof taskGithubIssues.$inferSelect;
