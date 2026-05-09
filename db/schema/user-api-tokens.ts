import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Personal Access Tokens pour l'API MCP HTTP. Le token brut
 * (`paradeos_pat_<random>`) n'est affiché qu'une fois à la création ;
 * en base on stocke uniquement le SHA-256.
 */
export const userApiTokens = pgTable(
  "user_api_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex("user_api_tokens_token_hash_unique").on(t.tokenHash),
    userIdx: index("user_api_tokens_user_idx").on(t.userId),
  }),
);

export type UserApiToken = typeof userApiTokens.$inferSelect;
