import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "../../db/schema/contacts";
import { projects } from "../../db/schema/projects";
import { taskAssignees } from "../../db/schema/task-assignees";
import { tasks } from "../../db/schema/tasks";
import { timeEntries } from "../../db/schema/time-entries";
import { users } from "../../db/schema/users";
import { matchOpenTask } from "../../lib/crm/candidates";
import { isCertainMatch } from "../../lib/crm/pick";
import { setTaskAssignees } from "../../lib/db/queries/task-assignees";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

export const listTasksSchema = z.object({
  projectId: z.string().uuid().optional(),
  /** Filtre par membre interne (n'importe quelle tâche où il est dans la liste d'assignés). */
  assigneeId: z.string().uuid().optional(),
  status: z
    .enum(["todo", "in_progress", "awaiting_client", "blocked", "done", "cancelled"])
    .optional(),
  openOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listTasks(args: z.infer<typeof listTasksSchema>) {
  const conn = db();
  const conds = [];
  if (args.projectId) conds.push(eq(tasks.projectId, args.projectId));
  if (args.assigneeId)
    conds.push(
      sql`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${args.assigneeId})` as ReturnType<
        typeof eq
      >,
    );
  if (args.status) conds.push(eq(tasks.status, args.status));
  if (args.openOnly)
    conds.push(sql`${tasks.status} not in ('done', 'cancelled')` as ReturnType<typeof eq>);

  const rows = await conn
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(args.limit ?? DEFAULT_LIMIT);

  // Hydrate les assignés en 1 requête. Évite N+1.
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return rows.map((r) => ({ ...r, assignees: [] }));
  const assigneesRows = await conn
    .select({
      taskId: taskAssignees.taskId,
      kind: taskAssignees.kind,
      userId: taskAssignees.userId,
      userName: users.fullName,
      contactId: taskAssignees.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
    })
    .from(taskAssignees)
    .leftJoin(users, eq(users.id, taskAssignees.userId))
    .leftJoin(contacts, eq(contacts.id, taskAssignees.contactId))
    .where(inArray(taskAssignees.taskId, ids));
  const byTask = new Map<
    string,
    Array<{ kind: "user" | "contact"; id: string; name: string | null }>
  >();
  for (const a of assigneesRows) {
    const list = byTask.get(a.taskId) ?? [];
    if (a.kind === "user" && a.userId) list.push({ kind: "user", id: a.userId, name: a.userName });
    else if (a.kind === "contact" && a.contactId)
      list.push({
        kind: "contact",
        id: a.contactId,
        name: `${a.contactFirstName ?? ""} ${a.contactLastName ?? ""}`.trim() || null,
      });
    byTask.set(a.taskId, list);
  }
  return rows.map((r) => ({ ...r, assignees: byTask.get(r.id) ?? [] }));
}

export async function listMyTasks(_args: unknown, ctx: UserContext) {
  const conn = db();
  return conn
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        sql`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${ctx.userId})`,
        sql`${tasks.status} not in ('done', 'cancelled')`,
      ),
    )
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(100);
}

export const listMyTimeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  projectId: z.string().uuid().optional(),
});

export async function listMyTime(args: z.infer<typeof listMyTimeSchema>, ctx: UserContext) {
  const conn = db();
  const conds = [eq(timeEntries.userId, ctx.userId)];
  if (args.from) conds.push(gte(timeEntries.startAt, new Date(args.from)));
  if (args.to) conds.push(lte(timeEntries.startAt, new Date(args.to)));
  if (args.projectId) conds.push(eq(timeEntries.projectId, args.projectId));

  const rows = await conn
    .select({
      id: timeEntries.id,
      kind: timeEntries.kind,
      startAt: timeEntries.startAt,
      endAt: timeEntries.endAt,
      title: timeEntries.title,
      projectId: timeEntries.projectId,
      projectName: projects.name,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(and(...conds))
    .orderBy(desc(timeEntries.startAt))
    .limit(200);

  const totalMinutes = rows.reduce((acc, r) => {
    const ms = new Date(r.endAt).getTime() - new Date(r.startAt).getTime();
    return acc + Math.max(0, ms / 60000);
  }, 0);

  return { entries: rows, totalMinutes: Math.round(totalMinutes) };
}

// ---------- WRITE TOOLS ----------

export const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  projectId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  description: z.string().max(5000).optional(),
});

export async function createTask(args: z.infer<typeof createTaskSchema>, ctx: UserContext) {
  const conn = db();
  // Garde-fou doublon : même titre (après normalisation) déjà ouvert sur le
  // même projet → on renvoie la tâche existante. Un agent qui reprend un
  // compte rendu deux fois ne doit pas doubler la liste à faire.
  const existingTask = await matchOpenTask(conn, args.title, args.projectId ?? null);
  if (existingTask && isCertainMatch(existingTask)) {
    return { id: existingTask.id, title: existingTask.name, alreadyExisted: true as const };
  }
  // Source de vérité = task_assignees. Si `assigneeId` n'est pas fourni,
  // l'auteur est ajouté par défaut (parité avec quickCreateTask).
  const assigneeUserId = args.assigneeId ?? ctx.userId;
  const row = await conn.transaction(async (tx) => {
    const [r] = await tx
      .insert(tasks)
      .values({
        title: args.title,
        description: args.description ?? null,
        status: "todo",
        priority: args.priority ?? "medium",
        projectId: args.projectId ?? null,
        assigneeId: null,
        assigneeContactId: null,
        dueDate: args.dueDate ?? null,
        startDate: args.startDate ?? null,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
      })
      .returning({ id: tasks.id, title: tasks.title });
    if (!r) return null;
    await setTaskAssignees(tx, r.id, [{ kind: "user", id: assigneeUserId }], ctx.userId);
    return r;
  });
  return row;
}

export const completeTaskSchema = z.object({
  id: z.string().uuid(),
});

export async function completeTask(args: z.infer<typeof completeTaskSchema>) {
  const conn = db();
  await conn
    .update(tasks)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(tasks.id, args.id));
  return { id: args.id, status: "done" as const };
}

export const logTimeSchema = z.object({
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  startAt: z.string(),
  endAt: z.string(),
  kind: z.enum(["planned", "actual"]).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
});

export async function logTime(args: z.infer<typeof logTimeSchema>, ctx: UserContext) {
  const start = new Date(args.startAt);
  const end = new Date(args.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("startAt / endAt doivent être des dates ISO 8601 valides.");
  }
  if (end <= start) throw new Error("endAt doit être > startAt.");

  const conn = db();
  const [row] = await conn
    .insert(timeEntries)
    .values({
      userId: ctx.userId,
      kind: args.kind ?? "actual",
      startAt: start,
      endAt: end,
      title: args.title ?? null,
      description: args.description ?? null,
      projectId: args.projectId ?? null,
      taskId: args.taskId ?? null,
      contactId: args.contactId ?? null,
    })
    .returning({ id: timeEntries.id });
  return row;
}
