import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { tasks } from "./tasks";
import { users } from "./users";

export const taskAssigneeKind = pgEnum("task_assignee_kind", ["user", "contact"]);

/**
 * M:N entre tasks et (users | contacts). Chaque row = un assigné, soit
 * interne (kind="user", user_id rempli) soit externe (kind="contact",
 * contact_id rempli). Le CHECK XOR assure qu'un seul des deux champs est
 * posé en cohérence avec `kind`.
 *
 * PK = uuid synthétique. `user_id` / `contact_id` ne peuvent pas servir de
 * PK car PostgreSQL rendrait leurs colonnes NOT NULL — incompatible avec
 * le XOR. Unicité par 2 index partiels.
 */
export const taskAssignees = pgTable(
  "task_assignees",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: taskAssigneeKind("kind").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    taskIdx: index("task_assignees_task_idx").on(table.taskId),
    userIdx: index("task_assignees_user_idx").on(table.userId),
    contactIdx: index("task_assignees_contact_idx").on(table.contactId),
    userUniq: uniqueIndex("task_assignees_user_uniq")
      .on(table.taskId, table.userId)
      .where(sql`kind = 'user'`),
    contactUniq: uniqueIndex("task_assignees_contact_uniq")
      .on(table.taskId, table.contactId)
      .where(sql`kind = 'contact'`),
    kindXor: check(
      "task_assignees_kind_xor",
      sql`(kind = 'user' AND user_id IS NOT NULL AND contact_id IS NULL)
        OR (kind = 'contact' AND contact_id IS NOT NULL AND user_id IS NULL)`,
    ),
  }),
);

export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type NewTaskAssignee = typeof taskAssignees.$inferInsert;
