import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
/**
 * Définition des tools MCP : lectures, écritures, recherche.
 *
 * Chaque tool reçoit `(args, ctx)` où `ctx` porte le `userId` du
 * caller (résolu via env stdio ou token HTTP). Les tools "perso"
 * (préfixés `my_*`) filtrent par ctx.userId ; les tools "team"
 * exposent les données partagées.
 */
import { contacts } from "../db/schema/contacts";
import { entities } from "../db/schema/entities";
import { meetingProposals, meetings } from "../db/schema/meetings";
import { notes } from "../db/schema/notes";
import { projects } from "../db/schema/projects";
import { tasks } from "../db/schema/tasks";
import { timeEntries } from "../db/schema/time-entries";
import { users } from "../db/schema/users";
import type { UserContext } from "./context";
import { db } from "./db";

/** Helper : limite par défaut sur les listes pour ne pas saturer. */
const DEFAULT_LIMIT = 50;

// ---------- READ TOOLS ----------

export const listProjectsSchema = z.object({
  status: z
    .enum([
      "not_started",
      "to_follow_up",
      "awaiting_response",
      "won",
      "lost",
      "planning",
      "active",
      "on_hold",
      "completed",
      "archived",
    ])
    .optional(),
  kind: z.enum(["client", "product", "transverse"]).optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listProjects(args: z.infer<typeof listProjectsSchema>) {
  const conn = db();
  const conds = [];
  if (args.status) conds.push(eq(projects.status, args.status));
  if (args.kind) conds.push(eq(projects.kind, args.kind));
  if (args.search) {
    const like = `%${args.search}%`;
    const o = or(ilike(projects.name, like), ilike(entities.name, like));
    if (o) conds.push(o);
  }
  return conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      status: projects.status,
      entityName: entities.name,
      ownerId: projects.ownerId,
      startDate: projects.startDate,
      endDate: projects.endDate,
      valueAmount: projects.valueAmount,
      probability: projects.probability,
      followUpDate: projects.followUpDate,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(projects.updatedAt))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const getProjectSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().optional(),
});

export async function getProject(args: z.infer<typeof getProjectSchema>) {
  if (!args.id && !args.name) {
    throw new Error("Fournis `id` ou `name`.");
  }
  const conn = db();
  const where = args.id ? eq(projects.id, args.id) : ilike(projects.name, `%${args.name}%`);
  const [proj] = await conn
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  if (!proj) return null;

  const [entity] = proj.entityId
    ? await conn.select().from(entities).where(eq(entities.id, proj.entityId)).limit(1)
    : [null];

  const [owner] = proj.ownerId
    ? await conn.select().from(users).where(eq(users.id, proj.ownerId)).limit(1)
    : [null];

  const taskRows = await conn
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
    })
    .from(tasks)
    .where(eq(tasks.projectId, proj.id))
    .orderBy(asc(tasks.dueDate));

  const [stats] = await conn
    .select({
      plannedMinutes: sql<number>`coalesce(sum(case when ${timeEntries.kind} = 'planned' then extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60 else 0 end), 0)::int`,
      actualMinutes: sql<number>`coalesce(sum(case when ${timeEntries.kind} = 'actual' then extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60 else 0 end), 0)::int`,
    })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, proj.id));

  return {
    project: proj,
    entity,
    owner: owner ? { id: owner.id, fullName: owner.fullName } : null,
    tasks: {
      total: taskRows.length,
      open: taskRows.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
      list: taskRows.slice(0, 20),
    },
    time: stats ?? { plannedMinutes: 0, actualMinutes: 0 },
  };
}

export const listTasksSchema = z.object({
  projectId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional(),
  openOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listTasks(args: z.infer<typeof listTasksSchema>) {
  const conn = db();
  const conds = [];
  if (args.projectId) conds.push(eq(tasks.projectId, args.projectId));
  if (args.assigneeId) conds.push(eq(tasks.assigneeId, args.assigneeId));
  if (args.status) conds.push(eq(tasks.status, args.status));
  if (args.openOnly)
    conds.push(sql`${tasks.status} not in ('done', 'cancelled')` as ReturnType<typeof eq>);

  return conn
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      projectId: tasks.projectId,
      projectName: projects.name,
      assigneeId: tasks.assigneeId,
      assigneeName: users.fullName,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(args.limit ?? DEFAULT_LIMIT);
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
    .where(and(eq(tasks.assigneeId, ctx.userId), sql`${tasks.status} not in ('done', 'cancelled')`))
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(100);
}

export const listMeetingsSchema = z.object({
  projectId: z.string().uuid().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export async function listMeetings(args: z.infer<typeof listMeetingsSchema>) {
  const conn = db();
  const conds = [];
  if (args.projectId) conds.push(eq(meetings.projectId, args.projectId));
  if (args.since) conds.push(gte(meetings.occurredAt, new Date(args.since)));

  return conn
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      summary: meetings.summary,
      status: meetings.status,
      projectId: meetings.projectId,
      projectName: projects.name,
      sourceLabel: meetings.sourceLabel,
    })
    .from(meetings)
    .leftJoin(projects, eq(projects.id, meetings.projectId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(meetings.occurredAt))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const getMeetingSchema = z.object({ id: z.string().uuid() });

export async function getMeeting(args: z.infer<typeof getMeetingSchema>) {
  const conn = db();
  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, args.id)).limit(1);
  if (!meeting) return null;

  const proposals = await conn
    .select()
    .from(meetingProposals)
    .where(eq(meetingProposals.meetingId, meeting.id))
    .orderBy(asc(meetingProposals.createdAt));

  return { meeting, proposals };
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

export const listContactsSchema = z.object({
  entityId: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listContacts(args: z.infer<typeof listContactsSchema>) {
  const conn = db();
  const conds = [];
  if (args.entityId) conds.push(eq(contacts.entityId, args.entityId));
  if (args.search) {
    const like = `%${args.search}%`;
    const o = or(
      ilike(contacts.firstName, like),
      ilike(contacts.lastName, like),
      ilike(contacts.email, like),
    );
    if (o) conds.push(o);
  }
  return conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      jobTitle: contacts.jobTitle,
      entityName: entities.name,
    })
    .from(contacts)
    .leftJoin(entities, eq(entities.id, contacts.entityId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const listEntitiesSchema = z.object({
  kind: z.enum(["client", "prospect", "partner", "supplier", "other"]).optional(),
  search: z.string().optional(),
});

export async function listEntities(args: z.infer<typeof listEntitiesSchema>) {
  const conn = db();
  const conds = [];
  if (args.kind) conds.push(eq(entities.kind, args.kind));
  if (args.search) conds.push(ilike(entities.name, `%${args.search}%`));
  return conn
    .select({ id: entities.id, name: entities.name, kind: entities.kind })
    .from(entities)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(entities.name))
    .limit(100);
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
  const [row] = await conn
    .insert(tasks)
    .values({
      title: args.title,
      description: args.description ?? null,
      status: "todo",
      priority: args.priority ?? "medium",
      projectId: args.projectId ?? null,
      assigneeId: args.assigneeId ?? ctx.userId,
      dueDate: args.dueDate ?? null,
      startDate: args.startDate ?? null,
      ownerId: ctx.userId,
      createdBy: ctx.userId,
    })
    .returning({ id: tasks.id, title: tasks.title });
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

export const addNoteSchema = z.object({
  subjectType: z.enum(["entity", "contact", "opportunity", "project", "task"]),
  subjectId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
  title: z.string().max(200).optional(),
  kind: z.enum(["memo", "call", "meeting", "message"]).optional(),
});

export async function addNote(args: z.infer<typeof addNoteSchema>, ctx: UserContext) {
  const conn = db();
  const [row] = await conn
    .insert(notes)
    .values({
      title: args.title ?? null,
      content: args.content,
      kind: args.kind ?? "memo",
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      authorId: ctx.userId,
    })
    .returning({ id: notes.id });
  return row;
}

// ---------- SEARCH ----------

export const searchAllSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
});

export async function searchAll(args: z.infer<typeof searchAllSchema>) {
  const conn = db();
  const limit = args.limit ?? 10;
  const like = `%${args.query}%`;

  const [projectsHits, tasksHits, contactsHits, entitiesHits, meetingsHits] = await Promise.all([
    conn
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(ilike(projects.name, like))
      .limit(limit),
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .where(ilike(tasks.title, like))
      .limit(limit),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(contacts)
      .where(
        or(
          ilike(contacts.firstName, like),
          ilike(contacts.lastName, like),
          ilike(contacts.email, like),
        ),
      )
      .limit(limit),
    conn
      .select({ id: entities.id, name: entities.name, kind: entities.kind })
      .from(entities)
      .where(ilike(entities.name, like))
      .limit(limit),
    conn
      .select({ id: meetings.id, title: meetings.title, occurredAt: meetings.occurredAt })
      .from(meetings)
      .where(or(ilike(meetings.title, like), ilike(meetings.summary, like)))
      .limit(limit),
  ]);

  return {
    projects: projectsHits,
    tasks: tasksHits,
    contacts: contactsHits,
    entities: entitiesHits,
    meetings: meetingsHits,
  };
}

// ---------- WRITE : Contacts ----------

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  jobTitle: z.string().max(160).optional(),
  linkedinUrl: z.string().url().optional(),
  entityId: z.string().uuid().optional(),
  qualification: z.enum(["lead", "client", "coworker", "partner", "supplier", "other"]).optional(),
  notes: z.string().max(5000).optional(),
});

export async function createContact(args: z.infer<typeof createContactSchema>, ctx: UserContext) {
  const conn = db();
  const [row] = await conn
    .insert(contacts)
    .values({
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email ?? null,
      phone: args.phone ?? null,
      jobTitle: args.jobTitle ?? null,
      linkedinUrl: args.linkedinUrl ?? null,
      entityId: args.entityId ?? null,
      qualification: args.qualification ?? null,
      notes: args.notes ?? null,
      ownerId: ctx.userId,
      createdBy: ctx.userId,
    })
    .returning({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    });
  return row;
}

export const updateContactSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  jobTitle: z.string().max(160).nullable().optional(),
  linkedinUrl: z.string().url().nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  qualification: z
    .enum(["lead", "client", "coworker", "partner", "supplier", "other"])
    .nullable()
    .optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateContact(args: z.infer<typeof updateContactSchema>) {
  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.firstName !== undefined) update.firstName = args.firstName;
  if (args.lastName !== undefined) update.lastName = args.lastName;
  if (args.email !== undefined) update.email = args.email;
  if (args.phone !== undefined) update.phone = args.phone;
  if (args.jobTitle !== undefined) update.jobTitle = args.jobTitle;
  if (args.linkedinUrl !== undefined) update.linkedinUrl = args.linkedinUrl;
  if (args.entityId !== undefined) update.entityId = args.entityId;
  if (args.qualification !== undefined) update.qualification = args.qualification;
  if (args.notes !== undefined) update.notes = args.notes;

  await conn.update(contacts).set(update).where(eq(contacts.id, args.id));
  return { id: args.id };
}

// ---------- WRITE : Entités ----------

export const createEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["client", "prospect", "partner", "supplier", "other"]).optional(),
  website: z.string().url().optional(),
  siren: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
  vatNumber: z.string().max(40).optional(),
  address: z
    .object({
      street: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  notes: z.string().max(5000).optional(),
});

export async function createEntity(args: z.infer<typeof createEntitySchema>, ctx: UserContext) {
  const conn = db();
  const [row] = await conn
    .insert(entities)
    .values({
      name: args.name,
      kind: args.kind ?? "prospect",
      website: args.website ?? null,
      siren: args.siren ?? null,
      vatNumber: args.vatNumber ?? null,
      address: args.address ?? null,
      notes: args.notes ?? null,
      ownerId: ctx.userId,
      createdBy: ctx.userId,
    })
    .returning({ id: entities.id, name: entities.name, kind: entities.kind });
  return row;
}

export const updateEntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["client", "prospect", "partner", "supplier", "other"]).optional(),
  website: z.string().url().nullable().optional(),
  siren: z
    .string()
    .regex(/^\d{9}$/)
    .nullable()
    .optional(),
  vatNumber: z.string().max(40).nullable().optional(),
  address: z
    .object({
      street: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
    })
    .nullable()
    .optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateEntity(args: z.infer<typeof updateEntitySchema>) {
  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.name !== undefined) update.name = args.name;
  if (args.kind !== undefined) update.kind = args.kind;
  if (args.website !== undefined) update.website = args.website;
  if (args.siren !== undefined) update.siren = args.siren;
  if (args.vatNumber !== undefined) update.vatNumber = args.vatNumber;
  if (args.address !== undefined) update.address = args.address;
  if (args.notes !== undefined) update.notes = args.notes;

  await conn.update(entities).set(update).where(eq(entities.id, args.id));
  return { id: args.id };
}

// Re-export for `inArray` not used in this file but available pour les callers
export const _internal = { inArray };
