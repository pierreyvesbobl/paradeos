"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { mentions } from "@/db/schema/mentions";
import { notes } from "@/db/schema/notes";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { getAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db/server";
import { sendEmail } from "@/lib/email/client";
import { renderMentionEmail } from "@/lib/email/templates";
import { getUserEmails } from "@/lib/email/users";
import {
  buildUserMentionResolver,
  extractUserMentionTokens,
  resolveMentionedUserIds,
} from "@/lib/mentions";
import {
  type NoteSubjectType,
  createNoteSchema,
  deleteNoteSchema,
  markAllMyMentionsReadSchema,
  updateNoteSchema,
} from "@/lib/schemas/notes";
import { and, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function fetchSubjectName(type: NoteSubjectType, id: string): Promise<string | null> {
  const conn = await db();
  switch (type) {
    case "entity": {
      const [r] = await conn
        .select({ name: entities.name })
        .from(entities)
        .where(eq(entities.id, id))
        .limit(1);
      return r?.name ?? null;
    }
    case "contact": {
      const [r] = await conn
        .select({ first: contacts.firstName, last: contacts.lastName })
        .from(contacts)
        .where(eq(contacts.id, id))
        .limit(1);
      return r ? `${r.first} ${r.last}` : null;
    }
    case "project": {
      const [r] = await conn
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);
      return r?.name ?? null;
    }
    case "task": {
      const [r] = await conn
        .select({ title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      return r?.title ?? null;
    }
  }
}

async function reindexMentions(
  noteId: string,
  content: string,
  authorId: string,
  noteContext: {
    title: string | null;
    subjectType: NoteSubjectType | null | undefined;
    subjectId: string | null | undefined;
    authorFullName: string | null;
  },
) {
  const conn = await db();
  const tokens = extractUserMentionTokens(content);

  // Récupère les mentions précédentes pour distinguer les nouvelles.
  const previous = await conn
    .select({ userId: mentions.userId })
    .from(mentions)
    .where(eq(mentions.noteId, noteId));
  const previousIds = new Set(previous.map((p) => p.userId));

  if (tokens.length === 0) {
    await conn.delete(mentions).where(eq(mentions.noteId, noteId));
    return;
  }

  const allUsers = await conn.select({ id: users.id, fullName: users.fullName }).from(users);
  const resolver = buildUserMentionResolver(allUsers);
  const mentionedIds = resolveMentionedUserIds(tokens, resolver).filter((id) => id !== authorId);

  await conn.delete(mentions).where(eq(mentions.noteId, noteId));
  if (mentionedIds.length === 0) return;

  await conn
    .insert(mentions)
    .values(
      mentionedIds.map((userId) => ({
        noteId,
        userId,
        authorId,
      })),
    )
    .onConflictDoNothing();

  // Notification email — uniquement pour les nouvelles mentions.
  const newMentionIds = mentionedIds.filter((id) => !previousIds.has(id));
  if (newMentionIds.length === 0) return;

  const appUrl = await getAppUrl();
  const [emails, subjectName] = await Promise.all([
    getUserEmails(newMentionIds),
    noteContext.subjectType && noteContext.subjectId
      ? fetchSubjectName(noteContext.subjectType, noteContext.subjectId)
      : Promise.resolve(null),
  ]);

  await Promise.all(
    newMentionIds.map(async (userId) => {
      const email = emails[userId];
      if (!email) return;
      const tpl = renderMentionEmail({
        appUrl,
        authorName: noteContext.authorFullName ?? "Un coéquipier",
        noteTitle: noteContext.title,
        noteContent: content,
        noteSubjectType: noteContext.subjectType ?? null,
        noteSubjectId: noteContext.subjectId ?? null,
        noteSubjectName: subjectName,
      });
      await sendEmail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        tags: [{ name: "type", value: "mention" }],
      });
    }),
  );
}

const SUBJECT_PATHS: Record<NoteSubjectType, (id: string) => string[]> = {
  entity: (id) => [`/entites/${id}`],
  contact: (id) => [`/contacts/${id}`],
  project: (id) => [`/projets/${id}`],
  task: (id) => [`/taches/${id}`],
};

function revalidateForSubject(
  subjectType: string | null | undefined,
  subjectId: string | null | undefined,
) {
  revalidatePath("/notes");
  if (subjectType && subjectId && subjectType in SUBJECT_PATHS) {
    for (const path of SUBJECT_PATHS[subjectType as NoteSubjectType](subjectId)) {
      revalidatePath(path);
    }
  }
}

async function fetchAuthorFullName(userId: string): Promise<string | null> {
  const conn = await db();
  const [row] = await conn
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.fullName ?? null;
}

export const createNote = action(createNoteSchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(notes)
    .values({
      title: input.title ?? null,
      content: input.content,
      kind: input.kind,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      occurredAt: new Date(input.occurredAt),
      authorId: user.id,
    })
    .returning({ id: notes.id });

  if (row?.id) {
    const authorFullName = await fetchAuthorFullName(user.id);
    await reindexMentions(row.id, input.content, user.id, {
      title: input.title ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      authorFullName,
    });
  }

  revalidateForSubject(input.subjectType, input.subjectId);
  return { id: row?.id };
});

export const updateNote = action(updateNoteSchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .update(notes)
    .set({
      title: input.title ?? null,
      content: input.content,
      kind: input.kind,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      occurredAt: new Date(input.occurredAt),
    })
    .where(eq(notes.id, input.id));

  const authorFullName = await fetchAuthorFullName(user.id);
  await reindexMentions(input.id, input.content, user.id, {
    title: input.title ?? null,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    authorFullName,
  });

  revalidateForSubject(input.subjectType, input.subjectId);
  return { id: input.id };
});

export const markAllMyMentionsRead = action(markAllMyMentionsReadSchema, async ({ user }) => {
  const conn = await db();
  await conn
    .update(mentions)
    .set({ readAt: new Date() })
    .where(
      and(eq(mentions.userId, user.id), isNull(mentions.readAt), ne(mentions.authorId, user.id)),
    );
  revalidatePath("/notes");
  return { ok: true as const };
});

export const deleteNote = action(deleteNoteSchema, async ({ input }) => {
  const conn = await db();
  const [row] = await conn
    .select({ subjectType: notes.subjectType, subjectId: notes.subjectId })
    .from(notes)
    .where(eq(notes.id, input.id))
    .limit(1);

  await conn.delete(notes).where(eq(notes.id, input.id));
  revalidateForSubject(row?.subjectType, row?.subjectId);
  return { id: input.id };
});
