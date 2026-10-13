import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

/**
 * Dépôts git rattachés à un projet. Sert au suivi automatique du temps
 * passé dans Claude Code : le mod lit le remote `origin` de la session et
 * le résout en projet Parade OS (cf. claude-mod/ et le tool MCP
 * `resolve_repo`).
 *
 * `remote` est normalisé par lib/git/remote.ts (`github.com/parade/x`,
 * sans protocole, sans user, sans `.git`, en minuscules) : la même URL
 * en SSH ou HTTPS, sur deux machines, tombe sur la même ligne. Un dépôt
 * n'appartient qu'à un projet (index unique), un projet peut en avoir
 * plusieurs.
 */
export const projectRepos = pgTable(
  "project_repos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    remote: text("remote").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    remoteUnique: uniqueIndex("project_repos_remote_unique").on(table.remote),
    projectIdx: index("project_repos_project_idx").on(table.projectId),
  }),
);

export type ProjectRepo = typeof projectRepos.$inferSelect;
export type NewProjectRepo = typeof projectRepos.$inferInsert;
