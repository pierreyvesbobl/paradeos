import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { gmailLinks, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { type SQL, and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

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

/** Threads liés à un sujet (projet/contact/entité). */
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
    .innerJoin(gmailLinks, eq(gmailLinks.threadId, gmailThreads.id))
    .where(and(eq(gmailLinks.linkKind, linkKind), eq(gmailLinks.linkId, linkId)))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

export type GmailThreadFilters = {
  query?: string;
  linkedOnly?: boolean;
  unlinkedOnly?: boolean;
  projectId?: string;
};

/** Timeline globale avec filtres (recherche + lié/non-lié). */
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
  if (filters.linkedOnly) {
    conditions.push(
      sql`exists (select 1 from public.gmail_links where thread_id = ${gmailThreads.id})`,
    );
  }
  if (filters.unlinkedOnly) {
    conditions.push(
      sql`not exists (select 1 from public.gmail_links where thread_id = ${gmailThreads.id})`,
    );
  }
  if (filters.projectId) {
    conditions.push(
      sql`exists (select 1 from public.gmail_links
                  where thread_id = ${gmailThreads.id}
                  and link_kind = 'project'
                  and link_id = ${filters.projectId})`,
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
  links: Array<{
    id: string;
    linkKind: "project" | "contact" | "entity";
    linkId: string;
    source: string;
    confidence: string | null;
    label: string | null;
  }>;
};

/** Détail d'un thread : messages chronologiques + liens résolus. */
export async function getThreadDetail(threadIdLocal: string): Promise<ThreadDetail | null> {
  const conn = await db();
  const [threadRow] = await conn
    .select()
    .from(gmailThreads)
    .where(eq(gmailThreads.id, threadIdLocal))
    .limit(1);
  if (!threadRow) return null;

  const [messageRows, linkRows] = await Promise.all([
    conn
      .select()
      .from(gmailMessages)
      .where(eq(gmailMessages.threadId, threadIdLocal))
      .orderBy(gmailMessages.internalDate),
    conn.select().from(gmailLinks).where(eq(gmailLinks.threadId, threadIdLocal)),
  ]);

  // Résout les labels (nom du projet/contact/entité) pour l'affichage.
  const projectIds = linkRows.filter((l) => l.linkKind === "project").map((l) => l.linkId);
  const contactIds = linkRows.filter((l) => l.linkKind === "contact").map((l) => l.linkId);
  const entityIds = linkRows.filter((l) => l.linkKind === "entity").map((l) => l.linkId);

  const [projectLabels, contactLabels, entityLabels] = await Promise.all([
    projectIds.length
      ? conn
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([]),
    contactIds.length
      ? conn
          .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts)
          .where(inArray(contacts.id, contactIds))
      : Promise.resolve([]),
    entityIds.length
      ? conn
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, entityIds))
      : Promise.resolve([]),
  ]);

  const labelMap = new Map<string, string>();
  for (const p of projectLabels) labelMap.set(`project:${p.id}`, p.name);
  for (const c of contactLabels) labelMap.set(`contact:${c.id}`, `${c.firstName} ${c.lastName}`);
  for (const e of entityLabels) labelMap.set(`entity:${e.id}`, e.name);

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
    links: linkRows.map((l) => ({
      id: l.id,
      linkKind: l.linkKind,
      linkId: l.linkId,
      source: l.source,
      confidence: l.confidence,
      label: labelMap.get(`${l.linkKind}:${l.linkId}`) ?? null,
    })),
  };
}

/** Compte les threads liés à un sujet (pour le badge sur les tabs). */
export async function countThreadsForSubject(
  linkKind: "project" | "contact" | "entity",
  linkId: string,
): Promise<number> {
  const conn = await db();
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(gmailLinks)
    .where(and(eq(gmailLinks.linkKind, linkKind), eq(gmailLinks.linkId, linkId)));
  return row?.n ?? 0;
}
