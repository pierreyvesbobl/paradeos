import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { gmailLinks, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { projectContacts } from "@/db/schema/project-contacts";
import { db } from "@/lib/db/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { GENERIC_EMAIL_DOMAINS, domainFromEmail, extractDomain } from "./domain";

/**
 * Auto-link d'un thread vers contacts/entités/projets sur la base des
 * participants (sender + recipients de tous les messages du thread).
 *
 * Heuristique :
 *   - sender/recipient email matche `contacts.email` → lie au contact
 *     (source=auto_contact, confidence=1.0) ET aux projets du contact
 *     via `project_contacts` (source=auto_contact, confidence=0.8).
 *   - sender/recipient domain matche `entities.website` (hors domaines
 *     génériques) → lie à l'entité (source=auto_contact, confidence=0.6).
 *
 * Idempotent : ON CONFLICT (thread_id, link_kind, link_id) DO NOTHING.
 */
export async function autoLinkThread(threadIdLocal: string): Promise<void> {
  const conn = await db();

  // 1. Récupère tous les emails impliqués (sender + recipients) sur les
  // messages du thread.
  const messages = await conn
    .select({
      fromEmail: gmailMessages.fromEmail,
      toEmails: gmailMessages.toEmails,
      ccEmails: gmailMessages.ccEmails,
    })
    .from(gmailMessages)
    .where(eq(gmailMessages.threadId, threadIdLocal));

  const involvedEmails = new Set<string>();
  for (const m of messages) {
    if (m.fromEmail) involvedEmails.add(m.fromEmail.toLowerCase());
    for (const e of m.toEmails ?? []) involvedEmails.add(e.toLowerCase());
    for (const e of m.ccEmails ?? []) involvedEmails.add(e.toLowerCase());
  }
  if (involvedEmails.size === 0) return;

  // 2. Match contacts par email.
  const involvedList = [...involvedEmails];
  const matchedContacts = await conn
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.email, involvedList));

  const contactIds = matchedContacts.map((c) => c.id);

  // 3. Match entités par domaine du website.
  const involvedDomains = new Set<string>();
  for (const e of involvedEmails) {
    const d = domainFromEmail(e);
    if (d && !GENERIC_EMAIL_DOMAINS.has(d)) involvedDomains.add(d);
  }
  const allEntities = involvedDomains.size
    ? await conn
        .select({ id: entities.id, website: entities.website })
        .from(entities)
        .where(isNotNull(entities.website))
    : [];
  const matchedEntities = allEntities.filter((e) => {
    const d = extractDomain(e.website);
    return d ? involvedDomains.has(d) : false;
  });

  // 4. Match projets via project_contacts (jointure depuis les contacts
  // matchés).
  const projectRows = contactIds.length
    ? await conn
        .select({ projectId: projectContacts.projectId })
        .from(projectContacts)
        .where(inArray(projectContacts.contactId, contactIds))
    : [];
  const projectIds = [...new Set(projectRows.map((r) => r.projectId))];

  // 5. Insert les liens en bulk (ignorer doublons via onConflictDoNothing).
  const rowsToInsert: Array<{
    threadId: string;
    linkKind: "project" | "contact" | "entity";
    linkId: string;
    source: "auto_contact" | "auto_llm" | "manual";
    confidence: string;
  }> = [];

  for (const c of matchedContacts) {
    rowsToInsert.push({
      threadId: threadIdLocal,
      linkKind: "contact",
      linkId: c.id,
      source: "auto_contact",
      confidence: "1.000",
    });
  }
  for (const e of matchedEntities) {
    rowsToInsert.push({
      threadId: threadIdLocal,
      linkKind: "entity",
      linkId: e.id,
      source: "auto_contact",
      confidence: "0.600",
    });
  }
  for (const pid of projectIds) {
    rowsToInsert.push({
      threadId: threadIdLocal,
      linkKind: "project",
      linkId: pid,
      source: "auto_contact",
      confidence: "0.800",
    });
  }

  if (rowsToInsert.length === 0) return;
  await conn.insert(gmailLinks).values(rowsToInsert).onConflictDoNothing();
}

/**
 * Lie manuellement un thread à un sujet (project / contact / entity).
 * Idempotent.
 */
export async function manualLinkThread(args: {
  threadId: string;
  linkKind: "project" | "contact" | "entity";
  linkId: string;
  createdBy: string;
}): Promise<void> {
  const conn = await db();
  await conn
    .insert(gmailLinks)
    .values({
      threadId: args.threadId,
      linkKind: args.linkKind,
      linkId: args.linkId,
      source: "manual",
      createdBy: args.createdBy,
    })
    .onConflictDoNothing();
}

/**
 * Délie un thread d'un sujet (peu importe la source).
 */
export async function unlinkThread(args: {
  threadId: string;
  linkKind: "project" | "contact" | "entity";
  linkId: string;
}): Promise<void> {
  const conn = await db();
  await conn
    .delete(gmailLinks)
    .where(
      and(
        eq(gmailLinks.threadId, args.threadId),
        eq(gmailLinks.linkKind, args.linkKind),
        eq(gmailLinks.linkId, args.linkId),
      ),
    );
}

/** Re-run de l'auto-link sur tous les threads (utile après import de contacts). */
export async function rebuildAllAutoLinks(userId: string): Promise<number> {
  const conn = await db();
  const rows = await conn
    .select({ id: gmailThreads.id })
    .from(gmailThreads)
    .where(eq(gmailThreads.userId, userId));
  for (const r of rows) await autoLinkThread(r.id);
  return rows.length;
}
