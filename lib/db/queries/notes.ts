import { noteAttachments } from "@/db/schema/note-attachments";
import { notes } from "@/db/schema/notes";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { type SQL, and, asc, desc, eq, gte, ilike, inArray, lt, or } from "drizzle-orm";

export type AttachmentRow = {
  id: string;
  noteId: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

export async function getAttachmentsForNotes(noteIds: string[]): Promise<AttachmentRow[]> {
  if (noteIds.length === 0) return [];
  const conn = await db();
  return conn
    .select({
      id: noteAttachments.id,
      noteId: noteAttachments.noteId,
      storagePath: noteAttachments.storagePath,
      fileName: noteAttachments.fileName,
      mimeType: noteAttachments.mimeType,
      sizeBytes: noteAttachments.sizeBytes,
    })
    .from(noteAttachments)
    .where(inArray(noteAttachments.noteId, noteIds))
    .orderBy(asc(noteAttachments.createdAt));
}

export type NoteRow = {
  id: string;
  title: string | null;
  content: string;
  kind: "memo" | "call" | "meeting" | "message";
  occurredAt: Date;
  authorId: string;
  authorName: string | null;
};

/**
 * Notes attachées à un sujet (project, contact, etc.), triées par
 * date métier descendante (la plus récente en premier).
 */
export async function getNotesForSubject(
  subjectType: NoteSubjectType,
  subjectId: string,
): Promise<NoteRow[]> {
  const conn = await db();
  return conn
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      kind: notes.kind,
      occurredAt: notes.occurredAt,
      authorId: users.id,
      authorName: users.fullName,
    })
    .from(notes)
    .innerJoin(users, eq(notes.authorId, users.id))
    .where(and(eq(notes.subjectType, subjectType), eq(notes.subjectId, subjectId)))
    .orderBy(desc(notes.occurredAt));
}

export type NotesFilter = {
  query?: string;
  kind?: NoteKind;
  subjectType?: NoteSubjectType;
  authorId?: string;
  /** Date métier ≥ start (inclus). */
  start?: Date;
  /** Date métier < end (exclus). */
  end?: Date;
  limit?: number;
  /** Tri sur `occurredAt`. Default: desc (récents en premier). */
  order?: "asc" | "desc";
};

export async function getRecentNotes(filter: NotesFilter = {}) {
  const conn = await db();
  const conditions: SQL[] = [];
  if (filter.kind) conditions.push(eq(notes.kind, filter.kind));
  if (filter.subjectType) conditions.push(eq(notes.subjectType, filter.subjectType));
  if (filter.authorId) conditions.push(eq(notes.authorId, filter.authorId));
  if (filter.start) conditions.push(gte(notes.occurredAt, filter.start));
  if (filter.end) conditions.push(lt(notes.occurredAt, filter.end));
  if (filter.query) {
    const pattern = `%${filter.query}%`;
    const orCond = or(ilike(notes.title, pattern), ilike(notes.content, pattern));
    if (orCond) conditions.push(orCond);
  }

  const dir = filter.order === "asc" ? asc : desc;
  return conn
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      kind: notes.kind,
      subjectType: notes.subjectType,
      subjectId: notes.subjectId,
      occurredAt: notes.occurredAt,
      authorId: users.id,
      authorName: users.fullName,
    })
    .from(notes)
    .innerJoin(users, eq(notes.authorId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dir(notes.occurredAt))
    .limit(filter.limit ?? 100);
}
