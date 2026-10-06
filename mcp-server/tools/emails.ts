import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "../../db/schema/contacts";
import { gmailMessages, gmailTags, gmailThreads, gmailThreadTags } from "../../db/schema/gmail";
import { projectContacts } from "../../db/schema/project-contacts";
import { projects } from "../../db/schema/projects";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

// Les threads sont attachés à un projet/entité via tags Gmail dédiés
// (gmail_tags + gmail_thread_tags). Pour compenser les trous d'auto-tag
// (entités sans website, contacts pas encore rattachés au projet), on
// enrichit `project` et `entity` avec un fallback participant : threads
// où un contact du sujet apparaît en from/to/cc. Pour `contact` on
// dérive tout au runtime — pas de label Gmail par contact.
// Tous les threads sont scopés par ctx.userId — un user ne voit que sa
// boîte. Pour le détail d'un thread on retourne le bodyText (HTML stripé
// côté ingestion) et on omet bodyHtml pour rester compact.

export const listEmailsSchema = z.object({
  subjectType: z.enum(["project", "entity", "contact"]),
  subjectId: z.string().uuid(),
  since: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const THREAD_COLS = {
  id: gmailThreads.id,
  gmailThreadId: gmailThreads.gmailThreadId,
  subject: gmailThreads.subject,
  snippet: gmailThreads.snippet,
  lastMessageAt: gmailThreads.lastMessageAt,
  messageCount: gmailThreads.messageCount,
  hasUnread: gmailThreads.hasUnread,
  participants: gmailThreads.participants,
} as const;

async function listThreadsByEmailParticipants(
  ctx: UserContext,
  emails: string[],
  sinceISO: string | undefined,
  limit: number,
) {
  if (emails.length === 0) return [];
  const conn = db();
  // On passe par IN (…) + unnest() pour esquiver le binding text[] côté
  // postgres-js (qui refuse les tableaux JS dans un `= ANY($1)`).
  const emailsSql = sql.join(
    emails.map((e) => sql`${e}`),
    sql`, `,
  );
  const conds = [
    eq(gmailThreads.userId, ctx.userId),
    sql`(
      lower(${gmailMessages.fromEmail}) in (${emailsSql})
      or exists (
        select 1 from unnest(${gmailMessages.toEmails}) as x
        where lower(x) in (${emailsSql})
      )
      or exists (
        select 1 from unnest(${gmailMessages.ccEmails}) as x
        where lower(x) in (${emailsSql})
      )
    )`,
  ];
  if (sinceISO) conds.push(gte(gmailThreads.lastMessageAt, new Date(sinceISO)));
  return conn
    .selectDistinct(THREAD_COLS)
    .from(gmailThreads)
    .innerJoin(gmailMessages, eq(gmailMessages.threadId, gmailThreads.id))
    .where(and(...conds))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(limit);
}

async function listThreadsByTag(
  ctx: UserContext,
  kind: "project" | "entity",
  targetIds: string[],
  sinceISO: string | undefined,
  limit: number,
) {
  if (targetIds.length === 0) return [];
  const conn = db();
  const conds = [
    eq(gmailThreads.userId, ctx.userId),
    eq(gmailTags.kind, kind),
    inArray(gmailTags.targetId, targetIds),
  ];
  if (sinceISO) conds.push(gte(gmailThreads.lastMessageAt, new Date(sinceISO)));
  return conn
    .selectDistinct(THREAD_COLS)
    .from(gmailThreads)
    .innerJoin(gmailThreadTags, eq(gmailThreadTags.threadId, gmailThreads.id))
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(and(...conds))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(limit);
}

export async function listEmails(args: z.infer<typeof listEmailsSchema>, ctx: UserContext) {
  const conn = db();
  const limit = args.limit ?? DEFAULT_LIMIT;

  if (args.subjectType === "contact") {
    const [contact] = await conn
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, args.subjectId))
      .limit(1);
    if (!contact?.email) return [];
    return listThreadsByEmailParticipants(ctx, [contact.email.toLowerCase()], args.since, limit);
  }

  // project / entity : on résout d'abord les IDs "sujet" (le projet ou
  // l'entité) et la liste d'emails des contacts rattachés, puis on fait
  // l'UNION tag(s) + participants.
  let entityIds: string[] = [];
  let projectId: string | null = null;
  if (args.subjectType === "project") {
    const [p] = await conn
      .select({ id: projects.id, entityId: projects.entityId })
      .from(projects)
      .where(eq(projects.id, args.subjectId))
      .limit(1);
    if (!p) return [];
    projectId = p.id;
    if (p.entityId) entityIds = [p.entityId];
  } else {
    entityIds = [args.subjectId];
  }

  // Emails des contacts rattachés : contacts liés au projet (M2M) +
  // contacts de son entité (ou contacts de l'entité pour subject=entity).
  const contactEmailRows = await conn
    .selectDistinct({ email: contacts.email })
    .from(contacts)
    .leftJoin(projectContacts, eq(projectContacts.contactId, contacts.id))
    .where(
      or(
        projectId ? eq(projectContacts.projectId, projectId) : sql`false`,
        entityIds.length > 0 ? inArray(contacts.entityId, entityIds) : sql`false`,
      ),
    );
  const participantEmails = contactEmailRows
    .map((r) => r.email?.toLowerCase())
    .filter((e): e is string => !!e);

  const [byProjectTag, byEntityTag, byParticipant] = await Promise.all([
    args.subjectType === "project"
      ? listThreadsByTag(ctx, "project", [args.subjectId], args.since, limit)
      : Promise.resolve([]),
    entityIds.length > 0
      ? listThreadsByTag(ctx, "entity", entityIds, args.since, limit)
      : Promise.resolve([]),
    participantEmails.length > 0
      ? listThreadsByEmailParticipants(ctx, participantEmails, args.since, limit)
      : Promise.resolve([]),
  ]);

  const dedup = new Map<string, (typeof byProjectTag)[number]>();
  for (const row of [...byProjectTag, ...byEntityTag, ...byParticipant]) {
    dedup.set(row.id, row);
  }
  return [...dedup.values()]
    .sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
}

export const getEmailThreadSchema = z.object({ id: z.string().uuid() });

export async function getEmailThread(args: z.infer<typeof getEmailThreadSchema>, ctx: UserContext) {
  const conn = db();
  const [thread] = await conn
    .select()
    .from(gmailThreads)
    .where(and(eq(gmailThreads.id, args.id), eq(gmailThreads.userId, ctx.userId)))
    .limit(1);
  if (!thread) return null;

  const [messageRows, tagRows] = await Promise.all([
    conn
      .select({
        id: gmailMessages.id,
        gmailMessageId: gmailMessages.gmailMessageId,
        fromEmail: gmailMessages.fromEmail,
        fromName: gmailMessages.fromName,
        toEmails: gmailMessages.toEmails,
        ccEmails: gmailMessages.ccEmails,
        subject: gmailMessages.subject,
        snippet: gmailMessages.snippet,
        bodyText: gmailMessages.bodyText,
        internalDate: gmailMessages.internalDate,
        labels: gmailMessages.labels,
        isDraft: gmailMessages.isDraft,
      })
      .from(gmailMessages)
      .where(eq(gmailMessages.threadId, thread.id))
      .orderBy(asc(gmailMessages.internalDate)),
    conn
      .select({
        tagId: gmailTags.id,
        kind: gmailTags.kind,
        targetId: gmailTags.targetId,
        labelName: gmailTags.labelName,
        source: gmailThreadTags.source,
      })
      .from(gmailThreadTags)
      .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
      .where(eq(gmailThreadTags.threadId, thread.id))
      .orderBy(asc(gmailTags.kind), asc(gmailTags.labelName)),
  ]);

  return {
    thread: {
      id: thread.id,
      gmailThreadId: thread.gmailThreadId,
      subject: thread.subject,
      snippet: thread.snippet,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      hasUnread: thread.hasUnread,
      participants: thread.participants,
    },
    messages: messageRows,
    tags: tagRows,
  };
}
