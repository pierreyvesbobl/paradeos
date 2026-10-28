import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks";

/**
 * Dernier instantané du `roadmap.json` d'un dépôt suivi
 * (`project_repos.roadmap_path`). Parade OS le lit, ne l'écrit jamais :
 * c'est l'état d'avancement réel, tenu par l'agent de code dans le dépôt.
 * `matchedSha` / `matchedAt` : sur quoi portait le dernier rapprochement
 * LLM tâches ↔ items, pour ne le relancer que si quelque chose a bougé.
 */
export const repoRoadmaps = pgTable("repo_roadmaps", {
  remote: text("remote").primaryKey(),
  path: text("path").notNull(),
  sha: text("sha"),
  content: jsonb("content").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().default(sql`now()`),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  matchedSha: text("matched_sha"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type RepoRoadmap = typeof repoRoadmaps.$inferSelect;

export const ROADMAP_LINK_STATUSES = ["suggested", "confirmed", "rejected"] as const;
export type RoadmapLinkStatus = (typeof ROADMAP_LINK_STATUSES)[number];

/**
 * Tâche ↔ item de feuille de route. `suggested` vient du LLM, `confirmed`
 * d'un humain (le statut de l'item pilote alors celui de la tâche),
 * `rejected` empêche de reproposer la paire. Une tâche n'a qu'un lien
 * confirmé ; un item peut en avoir plusieurs.
 */
export const taskRoadmapLinks = pgTable(
  "task_roadmap_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    remote: text("remote").notNull(),
    itemId: text("item_id").notNull(),
    status: text("status").$type<RoadmapLinkStatus>().notNull(),
    confidence: real("confidence"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Confirmé par la synchro (confiance au-dessus du seuil), pas par un humain. */
    auto: boolean("auto").notNull().default(false),
  },
  (table) => ({
    pairUnique: uniqueIndex("task_roadmap_links_pair_unique").on(
      table.taskId,
      table.remote,
      table.itemId,
    ),
    confirmedUnique: uniqueIndex("task_roadmap_links_confirmed_unique")
      .on(table.taskId)
      .where(sql`status = 'confirmed'`),
    remoteIdx: index("task_roadmap_links_remote_idx").on(table.remote, table.itemId),
  }),
);

export type TaskRoadmapLink = typeof taskRoadmapLinks.$inferSelect;
