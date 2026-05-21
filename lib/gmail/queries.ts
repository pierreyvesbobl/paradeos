import "server-only";

import { gmailMessages, gmailTags, gmailThreadTags, gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { type SQL, and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

export type GmailThreadRow = {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  hasUnread: boolean;
  participants: unknown;
};

/**
 * Threads tagués avec un tag dont kind=`linkKind` et target_id=linkId
 * (équivalent de l'ancien `listThreadsForSubject` via gmail_links).
 */
export async function listThreadsForSubject(
  linkKind: "project" | "contact" | "entity",
  linkId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<GmailThreadRow[]> {
  const conn = await db();
  return conn
    .select({
      id: gmailThreads.id,
      gmailThreadId: gmailThreads.gmailThreadId,
      subject: gmailThreads.subject,
      snippet: gmailThreads.snippet,
      lastMessageAt: gmailThreads.lastMessageAt,
      messageCount: gmailThreads.messageCount,
      hasUnread: gmailThreads.hasUnread,
      participants: gmailThreads.participants,
    })
    .from(gmailThreads)
    .innerJoin(gmailThreadTags, eq(gmailThreadTags.threadId, gmailThreads.id))
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(and(eq(gmailTags.kind, linkKind), eq(gmailTags.targetId, linkId)))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

export type GmailThreadFilters = {
  query?: string;
  taggedOnly?: boolean;
  untaggedOnly?: boolean;
  tagId?: string;
};

/** Timeline globale avec filtres. */
export async function listThreads(
  userId: string,
  filters: GmailThreadFilters = {},
  opts: { limit?: number; offset?: number } = {},
): Promise<GmailThreadRow[]> {
  const conn = await db();
  const conditions: SQL[] = [eq(gmailThreads.userId, userId)];

  if (filters.query) {
    const pattern = `%${filters.query}%`;
    const orCond = or(ilike(gmailThreads.subject, pattern), ilike(gmailThreads.snippet, pattern));
    if (orCond) conditions.push(orCond);
  }
  if (filters.taggedOnly) {
    conditions.push(
      sql`exists (select 1 from public.gmail_thread_tags where thread_id = ${gmailThreads.id})`,
    );
  }
  if (filters.untaggedOnly) {
    conditions.push(
      sql`not exists (select 1 from public.gmail_thread_tags where thread_id = ${gmailThreads.id})`,
    );
  }
  if (filters.tagId) {
    conditions.push(
      sql`exists (select 1 from public.gmail_thread_tags
                  where thread_id = ${gmailThreads.id}
                  and tag_id = ${filters.tagId})`,
    );
  }

  return conn
    .select({
      id: gmailThreads.id,
      gmailThreadId: gmailThreads.gmailThreadId,
      subject: gmailThreads.subject,
      snippet: gmailThreads.snippet,
      lastMessageAt: gmailThreads.lastMessageAt,
      messageCount: gmailThreads.messageCount,
      hasUnread: gmailThreads.hasUnread,
      participants: gmailThreads.participants,
    })
    .from(gmailThreads)
    .where(and(...conditions))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export type ThreadTagRow = {
  threadTagId: string;
  tagId: string;
  kind: "project" | "contact" | "entity" | "category";
  targetId: string | null;
  labelName: string;
  source: string;
  color: string | null;
};

export type ThreadDetail = {
  thread: {
    id: string;
    gmailThreadId: string;
    subject: string | null;
    lastMessageAt: Date | null;
    participants: unknown;
  };
  messages: Array<{
    id: string;
    gmailMessageId: string;
    fromEmail: string | null;
    fromName: string | null;
    toEmails: string[];
    ccEmails: string[];
    subject: string | null;
    snippet: string | null;
    bodyText: string | null;
    bodyHtml: string | null;
    internalDate: Date | null;
    labels: string[];
    isDraft: boolean;
    extractionStatus: string;
  }>;
  tags: ThreadTagRow[];
};

export async function getThreadDetail(threadIdLocal: string): Promise<ThreadDetail | null> {
  const conn = await db();
  const [threadRow] = await conn
    .select()
    .from(gmailThreads)
    .where(eq(gmailThreads.id, threadIdLocal))
    .limit(1);
  if (!threadRow) return null;

  const [messageRows, tagRows] = await Promise.all([
    conn
      .select()
      .from(gmailMessages)
      .where(eq(gmailMessages.threadId, threadIdLocal))
      .orderBy(gmailMessages.internalDate),
    conn
      .select({
        threadTagId: gmailThreadTags.id,
        tagId: gmailTags.id,
        kind: gmailTags.kind,
        targetId: gmailTags.targetId,
        labelName: gmailTags.labelName,
        source: gmailThreadTags.source,
        color: gmailTags.color,
      })
      .from(gmailThreadTags)
      .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
      .where(eq(gmailThreadTags.threadId, threadIdLocal))
      .orderBy(asc(gmailTags.kind), asc(gmailTags.labelName)),
  ]);

  return {
    thread: {
      id: threadRow.id,
      gmailThreadId: threadRow.gmailThreadId,
      subject: threadRow.subject,
      lastMessageAt: threadRow.lastMessageAt,
      participants: threadRow.participants,
    },
    messages: messageRows.map((m) => ({
      id: m.id,
      gmailMessageId: m.gmailMessageId,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toEmails: m.toEmails,
      ccEmails: m.ccEmails,
      subject: m.subject,
      snippet: m.snippet,
      bodyText: m.bodyText,
      bodyHtml: m.bodyHtml,
      internalDate: m.internalDate,
      labels: m.labels,
      isDraft: m.isDraft,
      extractionStatus: m.extractionStatus,
    })),
    tags: tagRows,
  };
}

/** Liste tous les tags d'un user (pour le picker + page tags). */
export async function listAllTags(
  userId: string,
  kind?: "project" | "contact" | "entity" | "category",
): Promise<
  Array<{
    id: string;
    kind: "project" | "contact" | "entity" | "category";
    targetId: string | null;
    labelName: string;
    gmailLabelId: string | null;
    color: string | null;
    threadCount: number;
  }>
> {
  const conn = await db();
  const conditions: SQL[] = [eq(gmailTags.userId, userId)];
  if (kind) conditions.push(eq(gmailTags.kind, kind));

  const rows = await conn
    .select({
      id: gmailTags.id,
      kind: gmailTags.kind,
      targetId: gmailTags.targetId,
      labelName: gmailTags.labelName,
      gmailLabelId: gmailTags.gmailLabelId,
      color: gmailTags.color,
      threadCount: sql<number>`(
        select count(*)::int from public.gmail_thread_tags
        where tag_id = ${gmailTags.id}
      )`,
    })
    .from(gmailTags)
    .where(and(...conditions))
    .orderBy(asc(gmailTags.kind), asc(gmailTags.labelName));

  return rows;
}

export async function countThreadsForSubject(
  linkKind: "project" | "contact" | "entity",
  linkId: string,
): Promise<number> {
  const conn = await db();
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(and(eq(gmailTags.kind, linkKind), eq(gmailTags.targetId, linkId)));
  return row?.n ?? 0;
}
