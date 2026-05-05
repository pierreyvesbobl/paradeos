import { mentions } from "@/db/schema/mentions";
import { notes } from "@/db/schema/notes";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { and, count, desc, eq, isNull, ne } from "drizzle-orm";

/** Compte des mentions non lues du user courant (hors self-mentions). */
export async function getUnreadMentionCount(userId: string): Promise<number> {
  const conn = await db();
  const [row] = await conn
    .select({ count: count() })
    .from(mentions)
    .where(
      and(eq(mentions.userId, userId), isNull(mentions.readAt), ne(mentions.authorId, userId)),
    );
  return Number(row?.count ?? 0);
}

/** Liste des mentions non lues + récentes du user, triées par date desc. */
export async function getRecentMentions(userId: string, limit = 10) {
  const conn = await db();
  return conn
    .select({
      mentionId: mentions.id,
      readAt: mentions.readAt,
      mentionedAt: mentions.createdAt,
      noteId: notes.id,
      noteTitle: notes.title,
      noteContent: notes.content,
      noteKind: notes.kind,
      subjectType: notes.subjectType,
      subjectId: notes.subjectId,
      authorName: users.fullName,
    })
    .from(mentions)
    .innerJoin(notes, eq(mentions.noteId, notes.id))
    .innerJoin(users, eq(mentions.authorId, users.id))
    .where(and(eq(mentions.userId, userId), ne(mentions.authorId, userId)))
    .orderBy(desc(mentions.createdAt))
    .limit(limit);
}
