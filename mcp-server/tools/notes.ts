import { and, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { z } from "zod";
import { notes } from "../../db/schema/notes";
import { users } from "../../db/schema/users";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

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
