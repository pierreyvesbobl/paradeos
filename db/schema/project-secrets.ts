import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

/**
 * Secrets attachés à un projet : mdp, clés API, tokens, etc.
 * `value`, `username` et `notes` sont chiffrés AES-256-GCM via
 * lib/crypto/secrets.ts (clé SECRETS_ENC_KEY). `label` et `url` restent
 * en clair pour permettre recherche/filtre futurs.
 */
export const projectSecrets = pgTable(
  "project_secrets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url"),
    usernameEnc: text("username_enc"),
    valueEnc: text("value_enc").notNull(),
    notesEnc: text("notes_enc"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Trace des consultations en clair : qui, quand, combien de fois. */
    revealCount: integer("reveal_count").notNull().default(0),
    lastRevealedAt: timestamp("last_revealed_at", { withTimezone: true }),
    lastRevealedBy: uuid("last_revealed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    projectIdx: index("project_secrets_project_idx").on(table.projectId),
  }),
);

export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type NewProjectSecret = typeof projectSecrets.$inferInsert;
