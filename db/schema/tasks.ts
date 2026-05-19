import { sql } from "drizzle-orm";
import { date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "awaiting_client",
  "blocked",
  "done",
  "cancelled",
]);

export const taskPriority = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

/**
 * Tâches = unités d'action concrètes. Attachables à un projet (le cas
 * standard) ou autonomes (todo perso). L'assignation à un user est
 * facultative — une tâche peut être "à prendre".
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatus("status").notNull().default("todo"),
    priority: taskPriority("priority").notNull().default("medium"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    /** Date de début pour la vue Gantt et la planification. Optionnel —
     * une tâche peut être seulement deadline-driven (`due_date` seul). */
    startDate: date("start_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    statusIdx: index("tasks_status_idx").on(table.status),
    priorityIdx: index("tasks_priority_idx").on(table.priority),
    projectIdx: index("tasks_project_idx").on(table.projectId),
    assigneeIdx: index("tasks_assignee_idx").on(table.assigneeId),
    dueDateIdx: index("tasks_due_date_idx").on(table.dueDate),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
