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
import { coworkingContracts } from "../db/schema/coworking";
import { entities } from "../db/schema/entities";
import { invoices as invoicesTable } from "../db/schema/invoices";
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

export const listNotesSchema = z.object({
  subjectType: z.enum(["entity", "contact", "opportunity", "project", "task"]).optional(),
  subjectId: z.string().uuid().optional(),
  kind: z.enum(["memo", "call", "meeting", "message"]).optional(),
  authorId: z.string().uuid().optional(),
  mine: z.boolean().optional(),
  search: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listNotes(args: z.infer<typeof listNotesSchema>, ctx: UserContext) {
  const conn = db();
  const conds = [];
  if (args.subjectType) conds.push(eq(notes.subjectType, args.subjectType));
  if (args.subjectId) conds.push(eq(notes.subjectId, args.subjectId));
  if (args.kind) conds.push(eq(notes.kind, args.kind));
  if (args.authorId) conds.push(eq(notes.authorId, args.authorId));
  if (args.mine) conds.push(eq(notes.authorId, ctx.userId));
  if (args.search) {
    const like = `%${args.search}%`;
    const o = or(ilike(notes.title, like), ilike(notes.content, like));
    if (o) conds.push(o);
  }
  if (args.since) conds.push(gte(notes.occurredAt, new Date(args.since)));
  if (args.until) conds.push(lte(notes.occurredAt, new Date(args.until)));

  return conn
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      kind: notes.kind,
      subjectType: notes.subjectType,
      subjectId: notes.subjectId,
      occurredAt: notes.occurredAt,
      authorId: notes.authorId,
      authorName: users.fullName,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(notes.occurredAt))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const getNoteSchema = z.object({ id: z.string().uuid() });

export async function getNote(args: z.infer<typeof getNoteSchema>) {
  const conn = db();
  const [row] = await conn
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      kind: notes.kind,
      subjectType: notes.subjectType,
      subjectId: notes.subjectId,
      occurredAt: notes.occurredAt,
      authorId: notes.authorId,
      authorName: users.fullName,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(eq(notes.id, args.id))
    .limit(1);
  return row ?? null;
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

  const [projectsHits, tasksHits, contactsHits, entitiesHits, meetingsHits, notesHits] =
    await Promise.all([
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
      conn
        .select({
          id: notes.id,
          title: notes.title,
          kind: notes.kind,
          subjectType: notes.subjectType,
          subjectId: notes.subjectId,
          occurredAt: notes.occurredAt,
          excerpt: sql<string>`substring(${notes.content} from 1 for 240)`,
        })
        .from(notes)
        .where(or(ilike(notes.title, like), ilike(notes.content, like)))
        .orderBy(desc(notes.occurredAt))
        .limit(limit),
    ]);

  return {
    projects: projectsHits,
    tasks: tasksHits,
    contacts: contactsHits,
    entities: entitiesHits,
    meetings: meetingsHits,
    notes: notesHits,
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

// ---------- PROJETS ----------
// Création/édition de projets (= opportunités en phase commerciale).
// IMPORTANT : `confirmed: true` est OBLIGATOIRE pour create_project,
// l'agent doit explicitement demander l'avis du user avant — cf.
// description côté registry MCP.

const projectKindEnum = z.enum(["client", "product", "transverse"]);
const projectStatusEnum = z.enum([
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
]);
const projectBillingTypeEnum = z.enum(["none", "fixed", "hourly"]);

export const createProjectSchema = z.object({
  /**
   * Garde-fou : l'agent DOIT poser la question à l'utilisateur avant
   * d'appeler ce tool et obtenir une confirmation explicite. Mettre
   * `true` uniquement après confirmation. Si false ou absent, le tool
   * échoue.
   */
  confirmed: z.literal(true, {
    errorMap: () => ({
      message:
        "Demande d'abord à l'utilisateur de confirmer la création du projet/opportunité avec tous les champs, puis renseigne confirmed=true.",
    }),
  }),
  name: z.string().trim().min(1).max(200),
  kind: projectKindEnum.default("client"),
  status: projectStatusEnum.default("not_started"),
  entityId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  billingType: projectBillingTypeEnum.default("none"),
  budgetAmount: z.number().nonnegative().nullable().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
  valueAmount: z.number().nonnegative().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  firstContactDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export async function createProject(args: z.infer<typeof createProjectSchema>, ctx: UserContext) {
  const conn = db();
  const [row] = await conn
    .insert(projects)
    .values({
      name: args.name,
      kind: args.kind,
      status: args.status,
      entityId: args.entityId ?? null,
      contactId: args.contactId ?? null,
      description: args.description ?? null,
      startDate: args.startDate ?? null,
      endDate: args.endDate ?? null,
      billingType: args.billingType,
      budgetAmount: args.budgetAmount != null ? args.budgetAmount.toString() : null,
      hourlyRate: args.hourlyRate != null ? args.hourlyRate.toString() : null,
      valueAmount: args.valueAmount != null ? args.valueAmount.toString() : null,
      probability: args.probability ?? null,
      source: args.source ?? null,
      firstContactDate: args.firstContactDate ?? null,
      followUpDate: args.followUpDate ?? null,
      expectedCloseDate: args.expectedCloseDate ?? null,
      ownerId: ctx.userId,
      createdBy: ctx.userId,
    })
    .returning({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      status: projects.status,
    });
  return row ?? null;
}

export const updateProjectSchema = z.object({
  id: z.string().uuid(),
  /** Confirmation requise pour les changements de status structurants
   * (won/lost/archived) — facultatif pour les autres mises à jour. */
  confirmed: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: projectKindEnum.optional(),
  status: projectStatusEnum.optional(),
  entityId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  billingType: projectBillingTypeEnum.optional(),
  budgetAmount: z.number().nonnegative().nullable().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
  valueAmount: z.number().nonnegative().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  firstContactDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  lastContactDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export async function updateProject(args: z.infer<typeof updateProjectSchema>) {
  // Garde-fou structurant : demander confirmation pour les transitions
  // commerciales finales (won/lost) et archived.
  const sensitiveStatus =
    args.status === "won" || args.status === "lost" || args.status === "archived";
  if (sensitiveStatus && args.confirmed !== true) {
    throw new Error(
      `Transition de statut vers "${args.status}" nécessite une confirmation explicite (confirmed=true). Demande l'avis de l'utilisateur d'abord.`,
    );
  }

  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.name !== undefined) update.name = args.name;
  if (args.kind !== undefined) update.kind = args.kind;
  if (args.status !== undefined) update.status = args.status;
  if (args.entityId !== undefined) update.entityId = args.entityId;
  if (args.contactId !== undefined) update.contactId = args.contactId;
  if (args.description !== undefined) update.description = args.description;
  if (args.startDate !== undefined) update.startDate = args.startDate;
  if (args.endDate !== undefined) update.endDate = args.endDate;
  if (args.billingType !== undefined) update.billingType = args.billingType;
  if (args.budgetAmount !== undefined)
    update.budgetAmount = args.budgetAmount != null ? args.budgetAmount.toString() : null;
  if (args.hourlyRate !== undefined)
    update.hourlyRate = args.hourlyRate != null ? args.hourlyRate.toString() : null;
  if (args.valueAmount !== undefined)
    update.valueAmount = args.valueAmount != null ? args.valueAmount.toString() : null;
  if (args.probability !== undefined) update.probability = args.probability;
  if (args.source !== undefined) update.source = args.source;
  if (args.firstContactDate !== undefined) update.firstContactDate = args.firstContactDate;
  if (args.lastContactDate !== undefined) update.lastContactDate = args.lastContactDate;
  if (args.followUpDate !== undefined) update.followUpDate = args.followUpDate;
  if (args.expectedCloseDate !== undefined) update.expectedCloseDate = args.expectedCloseDate;

  await conn.update(projects).set(update).where(eq(projects.id, args.id));
  return { id: args.id };
}

// ---------- COWORKING ----------

const contractStatusEnum = z.enum(["en_cours", "termine"]);
const billingFrequencyEnum = z.enum(["monthly", "quarterly"]);
const invoiceStatusEnum = z.enum(["a_facturer", "envoyee", "payee"]);
const invoiceBilledByEnum = z.enum(["parade", "g_and_o"]);

export const listCoworkingContractsSchema = z.object({
  status: contractStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listCoworkingContracts(args: z.infer<typeof listCoworkingContractsSchema>) {
  const conn = db();
  const conds = [];
  if (args.status) conds.push(eq(coworkingContracts.status, args.status));
  if (args.contactId) conds.push(eq(coworkingContracts.contactId, args.contactId));
  return conn
    .select({
      id: coworkingContracts.id,
      name: coworkingContracts.name,
      contactId: coworkingContracts.contactId,
      billToEntityId: coworkingContracts.billToEntityId,
      startDate: coworkingContracts.startDate,
      endDate: coworkingContracts.endDate,
      desks: coworkingContracts.desks,
      unitPriceHt: coworkingContracts.unitPriceHt,
      status: coworkingContracts.status,
      billingFrequency: coworkingContracts.billingFrequency,
    })
    .from(coworkingContracts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(coworkingContracts.startDate))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const getCoworkingContractSchema = z.object({ id: z.string().uuid() });

export async function getCoworkingContract(args: z.infer<typeof getCoworkingContractSchema>) {
  const conn = db();
  const [contract] = await conn
    .select()
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, args.id))
    .limit(1);
  if (!contract) return null;

  const invoiceRows = await conn
    .select({
      id: invoicesTable.id,
      name: invoicesTable.label,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      invoiceDate: invoicesTable.invoicedAt,
      status: invoicesTable.status,
      billedBy: invoicesTable.billedBy,
      desks: invoicesTable.desks,
      unitPriceHt: invoicesTable.unitPriceHt,
      vatRate: invoicesTable.vatRate,
      dougsInvoiceId: invoicesTable.dougsInvoiceId,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.coworkingContractId, args.id), eq(invoicesTable.kind, "coworking")))
    .orderBy(asc(invoicesTable.periodStart));

  return { contract, invoices: invoiceRows };
}

export const createCoworkingContractSchema = z.object({
  name: z.string().min(1).max(200),
  contactId: z.string().uuid().optional(),
  billToEntityId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  desks: z.number().int().positive(),
  unitPriceHt: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: contractStatusEnum.optional(),
  billingFrequency: billingFrequencyEnum.optional(),
  notes: z.string().max(5000).optional(),
});

export async function createCoworkingContract(
  args: z.infer<typeof createCoworkingContractSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [row] = await conn
    .insert(coworkingContracts)
    .values({
      name: args.name,
      contactId: args.contactId ?? null,
      billToEntityId: args.billToEntityId ?? null,
      startDate: args.startDate,
      endDate: args.endDate ?? null,
      desks: args.desks,
      unitPriceHt: args.unitPriceHt,
      status: args.status ?? "en_cours",
      billingFrequency: args.billingFrequency ?? "quarterly",
      notes: args.notes ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: coworkingContracts.id, name: coworkingContracts.name });
  return row;
}

export const updateCoworkingContractSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  contactId: z.string().uuid().nullable().optional(),
  billToEntityId: z.string().uuid().nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .nullable()
    .optional(),
  desks: z.number().int().positive().optional(),
  unitPriceHt: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional(),
  status: contractStatusEnum.optional(),
  billingFrequency: billingFrequencyEnum.optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateCoworkingContract(args: z.infer<typeof updateCoworkingContractSchema>) {
  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    "name",
    "contactId",
    "billToEntityId",
    "startDate",
    "endDate",
    "desks",
    "unitPriceHt",
    "status",
    "billingFrequency",
    "notes",
  ] as const) {
    const v = (args as Record<string, unknown>)[key];
    if (v !== undefined) update[key] = v;
  }
  await conn.update(coworkingContracts).set(update).where(eq(coworkingContracts.id, args.id));
  return { id: args.id };
}

export const listCoworkingInvoicesSchema = z.object({
  contractId: z.string().uuid().optional(),
  status: invoiceStatusEnum.optional(),
  limit: z.number().int().positive().max(200).optional(),
});

// Mapping API publique (anciennes valeurs) ↔ DB (nouvelles).
function toDbStatusCoworking(s: "a_facturer" | "envoyee" | "payee"): "draft" | "sent" | "paid" {
  if (s === "envoyee") return "sent";
  if (s === "payee") return "paid";
  return "draft";
}
function fromDbStatusCoworking(s: string): "a_facturer" | "envoyee" | "payee" {
  if (s === "sent") return "envoyee";
  if (s === "paid") return "payee";
  return "a_facturer";
}

export async function listCoworkingInvoices(args: z.infer<typeof listCoworkingInvoicesSchema>) {
  const conn = db();
  const conds = [eq(invoicesTable.kind, "coworking" as const)];
  if (args.contractId) conds.push(eq(invoicesTable.coworkingContractId, args.contractId));
  if (args.status) conds.push(eq(invoicesTable.status, toDbStatusCoworking(args.status)));
  const rows = await conn
    .select({
      id: invoicesTable.id,
      contractId: invoicesTable.coworkingContractId,
      contractName: coworkingContracts.name,
      name: invoicesTable.label,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      invoiceDate: invoicesTable.invoicedAt,
      status: invoicesTable.status,
      billedBy: invoicesTable.billedBy,
      desks: invoicesTable.desks,
      unitPriceHt: invoicesTable.unitPriceHt,
      vatRate: invoicesTable.vatRate,
      dougsInvoiceId: invoicesTable.dougsInvoiceId,
    })
    .from(invoicesTable)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoicesTable.coworkingContractId))
    .where(and(...conds))
    .orderBy(desc(invoicesTable.periodStart))
    .limit(args.limit ?? DEFAULT_LIMIT);
  return rows.map((r) => ({
    ...r,
    status: fromDbStatusCoworking(r.status),
    invoiceDate: r.invoiceDate
      ? `${r.invoiceDate.getFullYear()}-${String(r.invoiceDate.getMonth() + 1).padStart(2, "0")}-${String(r.invoiceDate.getDate()).padStart(2, "0")}`
      : null,
  }));
}

export const createCoworkingInvoiceSchema = z.object({
  contractId: z.string().uuid(),
  name: z.string().min(1).max(200),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  status: invoiceStatusEnum.optional(),
  billedBy: invoiceBilledByEnum.optional(),
  vatRate: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional(),
  notes: z.string().max(5000).optional(),
});

export async function createCoworkingInvoice(
  args: z.infer<typeof createCoworkingInvoiceSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [contract] = await conn
    .select({ desks: coworkingContracts.desks, unitPriceHt: coworkingContracts.unitPriceHt })
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, args.contractId))
    .limit(1);
  if (!contract) throw new Error("Contrat introuvable.");

  // Période × prix mensuel — mensuel × 1, trimestriel × 3 si on couvre
  // 3 mois. On dérive `months` de la période passée en arg.
  const startD = new Date(`${args.periodStart}T00:00:00`);
  const endD = new Date(`${args.periodEnd}T00:00:00`);
  const months = Math.max(
    1,
    (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth()) + 1,
  );
  const amountHt = Number(contract.unitPriceHt) * contract.desks * months;
  const [row] = await conn
    .insert(invoicesTable)
    .values({
      kind: "coworking",
      coworkingContractId: args.contractId,
      label: args.name,
      amountHt: amountHt.toFixed(2),
      vatRate: args.vatRate ?? "0.2",
      status: toDbStatusCoworking(args.status ?? "a_facturer"),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      desks: contract.desks,
      unitPriceHt: contract.unitPriceHt,
      billedBy: args.billedBy ?? "parade",
      invoicedAt: args.invoiceDate ? new Date(args.invoiceDate) : null,
      notes: args.notes ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: invoicesTable.id, name: invoicesTable.label });
  return row;
}

export const updateCoworkingInvoiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .nullable()
    .optional(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  status: invoiceStatusEnum.optional(),
  billedBy: invoiceBilledByEnum.optional(),
  vatRate: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateCoworkingInvoice(args: z.infer<typeof updateCoworkingInvoiceSchema>) {
  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.name !== undefined) update.label = args.name;
  if (args.invoiceDate !== undefined) {
    update.invoicedAt = args.invoiceDate ? new Date(args.invoiceDate) : null;
  }
  if (args.periodStart !== undefined) update.periodStart = args.periodStart;
  if (args.periodEnd !== undefined) update.periodEnd = args.periodEnd;
  if (args.status !== undefined) update.status = toDbStatusCoworking(args.status);
  if (args.billedBy !== undefined) update.billedBy = args.billedBy;
  if (args.vatRate !== undefined) update.vatRate = args.vatRate;
  if (args.notes !== undefined) update.notes = args.notes;
  await conn.update(invoicesTable).set(update).where(eq(invoicesTable.id, args.id));
  return { id: args.id };
}

/**
 * Génère la facture suivante pour un contrat. Période = lendemain de
 * la dernière facture (ou contrat.startDate si aucune) + N mois selon
 * billing_frequency. Statut initial `a_facturer`.
 *
 * Implémentation inlinée (le helper `lib/coworking/generate-invoice.ts`
 * dépend de Next via `server-only` et des path aliases — incompatible
 * avec le runtime tsx standalone du MCP stdio).
 */
export const generateNextCoworkingInvoiceSchema = z.object({
  contractId: z.string().uuid(),
});

export async function generateNextCoworkingInvoice(
  args: z.infer<typeof generateNextCoworkingInvoiceSchema>,
  ctx: UserContext,
) {
  const conn = db();
  const [contract] = await conn
    .select()
    .from(coworkingContracts)
    .where(eq(coworkingContracts.id, args.contractId))
    .limit(1);
  if (!contract) throw new Error("Contrat introuvable.");
  if (contract.status === "termine") throw new Error("Contrat terminé — pas de facture suivante.");

  const months = contract.billingFrequency === "monthly" ? 1 : 3;

  const [last] = await conn
    .select({ periodEnd: invoicesTable.periodEnd })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.coworkingContractId, args.contractId),
        eq(invoicesTable.kind, "coworking"),
      ),
    )
    .orderBy(desc(invoicesTable.periodStart))
    .limit(1);

  const refDate = last?.periodEnd
    ? addDays(parseDate(last.periodEnd), 1)
    : parseDate(contract.startDate);
  const periodStart = firstOfMonth(refDate);
  const periodEnd = lastOfMonth(addMonths(periodStart, months - 1));
  const label = periodLabel(periodStart, contract.billingFrequency);
  const amountHt = Number(contract.unitPriceHt) * contract.desks * months;

  const [row] = await conn
    .insert(invoicesTable)
    .values({
      kind: "coworking",
      coworkingContractId: args.contractId,
      label,
      amountHt: amountHt.toFixed(2),
      vatRate: "0.2",
      status: "draft",
      periodStart: fmtDate(periodStart),
      periodEnd: fmtDate(periodEnd),
      desks: contract.desks,
      unitPriceHt: contract.unitPriceHt,
      billedBy: "parade",
      createdBy: ctx.userId,
    })
    .returning({ id: invoicesTable.id, name: invoicesTable.label });
  return {
    ...row,
    periodStart: fmtDate(periodStart),
    periodEnd: fmtDate(periodEnd),
  };
}

// ---------- Helpers de date (locaux) ----------

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function lastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function periodLabel(start: Date, freq: "monthly" | "quarterly"): string {
  const year = start.getFullYear();
  if (freq === "monthly") {
    const monthName = start.toLocaleDateString("fr-FR", { month: "long" });
    return `${monthName} ${year}`;
  }
  const q = Math.floor(start.getMonth() / 3) + 1;
  return `T${q} ${year}`;
}

// Re-export for `inArray` not used in this file but available pour les callers
export const _internal = { inArray };
