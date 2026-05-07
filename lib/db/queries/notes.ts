import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { noteAttachments } from "@/db/schema/note-attachments";
import { notes } from "@/db/schema/notes";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import type { NoteSubjectType } from "@/lib/schemas/notes";
import { type SQL, and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

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

export type NoteSortField = "occurredAt" | "subject" | "kind" | "author";

export type NotesQuery = {
  /** Conditions SQL arbitraires (issues d'`applyFilters` côté page). */
  conditions?: SQL[];
  /** Recherche full-text (titre + contenu). */
  query?: string;
  limit?: number;
  /** Champ de tri. Default: occurredAt. */
  sortField?: NoteSortField;
  /** Direction de tri. Default: desc. */
  sortDir?: "asc" | "desc";
};

/**
 * Expression SQL `subject_label` réutilisée pour SELECT et ORDER BY.
 * Drizzle ne sait pas réutiliser un alias dans ORDER BY, donc on duplique
 * la logique CASE.
 */
const subjectLabelExpr = sql<string | null>`
  CASE ${notes.subjectType}
    WHEN 'project' THEN ${projects.name}
    WHEN 'contact' THEN trim(${contacts.firstName} || ' ' || ${contacts.lastName})
    WHEN 'entity' THEN ${entities.name}
    WHEN 'task' THEN ${tasks.title}
    ELSE NULL
  END
`;

function orderByFor(field: NoteSortField, dir: "asc" | "desc"): SQL[] {
  const apply = dir === "asc" ? asc : desc;
  switch (field) {
    case "occurredAt":
      return [apply(notes.occurredAt)];
    case "kind":
      return [apply(notes.kind), desc(notes.occurredAt)];
    case "subject":
      return [apply(subjectLabelExpr), desc(notes.occurredAt)];
    case "author":
      return [apply(users.fullName), desc(notes.occurredAt)];
    default:
      return [desc(notes.occurredAt)];
  }
}

export async function getRecentNotes(input: NotesQuery = {}) {
  const conn = await db();
  const conditions: SQL[] = [...(input.conditions ?? [])];
  if (input.query) {
    const pattern = `%${input.query}%`;
    const orCond = or(ilike(notes.title, pattern), ilike(notes.content, pattern));
    if (orCond) conditions.push(orCond);
  }

  const sortField = input.sortField ?? "occurredAt";
  const sortDir = input.sortDir ?? "desc";
  return conn
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      kind: notes.kind,
      subjectType: notes.subjectType,
      subjectId: notes.subjectId,
      /** Nom lisible du sujet (Refonte Acme, Pierre Dupont…). NULL si note libre. */
      subjectLabel: subjectLabelExpr.as("subject_label"),
      occurredAt: notes.occurredAt,
      authorId: users.id,
      authorName: users.fullName,
    })
    .from(notes)
    .innerJoin(users, eq(notes.authorId, users.id))
    .leftJoin(projects, and(eq(notes.subjectType, "project"), eq(notes.subjectId, projects.id)))
    .leftJoin(contacts, and(eq(notes.subjectType, "contact"), eq(notes.subjectId, contacts.id)))
    .leftJoin(entities, and(eq(notes.subjectType, "entity"), eq(notes.subjectId, entities.id)))
    .leftJoin(tasks, and(eq(notes.subjectType, "task"), eq(notes.subjectId, tasks.id)))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderByFor(sortField, sortDir))
    .limit(input.limit ?? 100);
}
