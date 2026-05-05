import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditAction = pgEnum("audit_action", ["insert", "update", "delete"]);

/**
 * Journal d'audit alimenté par le trigger générique `audit_log_trigger`
 * (cf. supabase/migrations). Une ligne par mutation, avec le diff
 * `before/after` en JSONB pour permettre les replays/diagnostics.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: auditAction("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    diff: jsonb("diff").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    tableRowIdx: index("audit_log_table_row_idx").on(table.tableName, table.rowId),
    userIdx: index("audit_log_user_idx").on(table.userId),
    createdAtIdx: index("audit_log_created_at_idx").on(table.createdAt),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
