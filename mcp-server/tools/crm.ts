import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "../../db/schema/contacts";
import { entities } from "../../db/schema/entities";
import { meetings } from "../../db/schema/meetings";
import { notes } from "../../db/schema/notes";
import { projects } from "../../db/schema/projects";
import { tasks } from "../../db/schema/tasks";
import { matchContact, matchEntity } from "../../lib/crm/candidates";
import { isCertainMatch } from "../../lib/crm/pick";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

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
  // Garde-fou doublon : un agent qui ne retrouve pas une fiche en crée une
  // seconde. Sur une correspondance certaine (email identique ou nom
  // strictement équivalent après normalisation), on renvoie l'existante —
  // `alreadyExisted` le dit explicitement pour que l'appelant ne croie pas
  // avoir créé quelque chose.
  const existing = await matchContact(conn, args.firstName, args.lastName, {
    email: args.email ?? null,
  });
  if (existing && isCertainMatch(existing)) {
    const [found] = await conn
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(eq(contacts.id, existing.id))
      .limit(1);
    return { ...found, alreadyExisted: true as const };
  }
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
  return { ...row, alreadyExisted: false as const };
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
  // Cf. `createContact` : « MKP Doctor » et « mkpdoctor » sont la même
  // société, et c'est l'agent qui écrit le nom au hasard de ce qu'il lit.
  const existing = await matchEntity(conn, args.name);
  if (existing && isCertainMatch(existing)) {
    const [found] = await conn
      .select({ id: entities.id, name: entities.name, kind: entities.kind })
      .from(entities)
      .where(eq(entities.id, existing.id))
      .limit(1);
    return { ...found, alreadyExisted: true as const };
  }
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
  return { ...row, alreadyExisted: false as const };
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
