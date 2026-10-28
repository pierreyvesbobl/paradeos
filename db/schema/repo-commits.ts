import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RoadmapLinkStatus } from "./repo-roadmaps";
import { tasks } from "./tasks";

export type CommitSource = "github" | "claude_code";

/**
 * Commits des dépôts suivis : ce qui a réellement été fait, par qui, quand.
 * Deux sources (GitHub relu par cron, mod Claude Code en session), une
 * ligne par (remote, sha). `matchedAt` : le rapprochement LLM l'a examiné.
 */
export const repoCommits = pgTable(
  "repo_commits",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    remote: text("remote").notNull(),
    sha: text("sha").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    author: text("author"),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
    url: text("url"),
    source: text("source").$type<CommitSource>().notNull(),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    remoteShaUnique: uniqueIndex("repo_commits_remote_sha_unique").on(table.remote, table.sha),
    remoteDateIdx: index("repo_commits_remote_date_idx").on(table.remote, table.committedAt),
  }),
);

export type RepoCommit = typeof repoCommits.$inferSelect;

/** Commit ↔ tâche : `confirmed` veut dire que ce commit livre la tâche. */
export const taskCommitLinks = pgTable(
  "task_commit_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    remote: text("remote").notNull(),
    sha: text("sha").notNull(),
    status: text("status").$type<RoadmapLinkStatus>().notNull(),
    confidence: real("confidence"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Confirmé par la synchro (confiance au-dessus du seuil), pas par un humain. */
    auto: boolean("auto").notNull().default(false),
  },
  (table) => ({
    pairUnique: uniqueIndex("task_commit_links_pair_unique").on(
      table.taskId,
      table.remote,
      table.sha,
    ),
    commitIdx: index("task_commit_links_commit_idx").on(table.remote, table.sha),
  }),
);

export type TaskCommitLink = typeof taskCommitLinks.$inferSelect;
