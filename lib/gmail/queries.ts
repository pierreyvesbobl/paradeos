import "server-only";

import { contacts } from "@/db/schema/contacts";
import { gmailMessages, gmailTags, gmailThreadTags, gmailThreads } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { type SQL, and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

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
 * Threads liés à un sujet CRM.
 *   - `project` / `entity` : via les liaisons actives (gmail_tags +
 *     gmail_thread_tags), donc décision humaine comprise
 *   - `contact` : dérivé au runtime via email match (pas de label Gmail
 *     par contact — voir links.ts pour le rationale)
 */
export async function listThreadsForSubject(
  linkKind: "project" | "contact" | "entity",
  linkId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<GmailThreadRow[]> {
  const conn = await db();

  if (linkKind === "contact") {
    // Récupère l'email du contact puis cherche les threads dont au moins
    // un message a ce contact en sender ou recipient (via DISTINCT thread).
    const [contact] = await conn
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, linkId))
      .limit(1);
    if (!contact?.email) return [];
    const email = contact.email.toLowerCase();
    return conn
      .selectDistinct({
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
      .innerJoin(gmailMessages, eq(gmailMessages.threadId, gmailThreads.id))
      .where(
        sql`(
          lower(${gmailMessages.fromEmail}) = ${email}
          or ${email} = any(${gmailMessages.toEmails})
          or ${email} = any(${gmailMessages.ccEmails})
        )`,
      )
      .orderBy(desc(gmailThreads.lastMessageAt))
      .limit(opts.limit ?? 20)
      .offset(opts.offset ?? 0);
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
    .innerJoin(gmailThreadTags, eq(gmailThreadTags.threadId, gmailThreads.id))
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(
      and(
        eq(gmailTags.kind, linkKind),
        eq(gmailTags.targetId, linkId),
        isNull(gmailThreadTags.dismissedAt),
      ),
    )
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

export type GmailThreadFilters = {
  query?: string;
  /**
   * Segmentation "priorité" :
   *   - important : lié à un projet/entité/contact AVEC action attendue
   *     (proposition pending actionnable OU needsReply=true).
   *   - invoices  : email de facturation (invoice_filing OU intent='compta').
   *   - noise     : le reste — notifications, newsletters, admin, etc.
   *   - undefined : pas de segmentation.
   */
  bucket?: "important" | "invoices" | "noise";
  /**
   * Sens de la facture détectée sur le thread. Ne s'applique qu'au
   * bucket `invoices` en pratique — un thread sans PJ classifiée ne
   * matche ni `purchase` ni `sale`.
   */
  invoiceDirection?: InvoiceDirectionFilter;
};

export type InvoiceDirectionFilter = "purchase" | "sale";

/**
 * Le thread porte au moins une PJ classifiée dans ce sens. On passe par
 * `invoice_filings` plutôt que par le tag Gmail : la colonne est la
 * source de vérité, le tag n'en est que le miroir (et l'utilisateur peut
 * le retirer à la main sans qu'on perde la classification).
 */
function invoiceDirectionSql(direction: InvoiceDirectionFilter): SQL {
  return sql`exists (
    select 1 from public.invoice_filings f
    join public.gmail_messages im on im.id = f.message_id
    where im.thread_id = gmail_threads.id
      and f.direction = ${direction}::invoice_filing_direction
  )`;
}

/**
 * Prédicats SQL réutilisés entre `listThreads` et `countBuckets`.
 * Les catégories sont mutuellement exclusives par ordre de priorité :
 *   invoices > important > noise.
 */
const BUCKET_SQL = {
  invoices: sql`(
    exists (
      select 1 from public.invoice_filings f
      join public.gmail_messages im on im.id = f.message_id
      where im.thread_id = gmail_threads.id
    )
    or exists (
      select 1 from public.gmail_messages im
      where im.thread_id = gmail_threads.id
        and im.extraction_meta->>'intent' = 'compta'
    )
  )`,
  /**
   * "Important" au sens strict : lié à un projet/contact/entité ET porte
   * une action à traiter (proposition pending actionnable OU needsReply).
   * Un mail sans lien CRM mais qui attend une réponse compte aussi — utile
   * pour attraper les premiers contacts pas encore rattachés.
   */
  important: sql`(
    exists (
      select 1 from public.email_proposals ep
      join public.gmail_messages im on im.id = ep.message_id
      where im.thread_id = gmail_threads.id
        and ep.status = 'pending'
        and ep.kind in ('task', 'draft_reply', 'project', 'contact', 'entity')
    )
    or exists (
      select 1 from public.gmail_messages im
      where im.thread_id = gmail_threads.id
        and (im.extraction_meta->>'needsReply')::boolean = true
    )
    or (
      exists (
        select 1 from public.gmail_thread_tags tt
        join public.gmail_tags g on g.id = tt.tag_id
        where tt.thread_id = gmail_threads.id
          and tt.dismissed_at is null
          and g.kind in ('project', 'contact', 'entity')
      )
      and gmail_threads.has_unread = true
    )
  )`,
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

  if (filters.invoiceDirection) {
    conditions.push(invoiceDirectionSql(filters.invoiceDirection));
  }

  if (filters.bucket === "invoices") {
    conditions.push(BUCKET_SQL.invoices);
  } else if (filters.bucket === "important") {
    // Un thread facturation apparaît DANS "invoices" et pas dans
    // "important" — priorité invoices pour lever l'ambiguïté sur les
    // mails compta qui pourraient aussi avoir une tâche pending.
    conditions.push(sql`not (${BUCKET_SQL.invoices})`);
    conditions.push(BUCKET_SQL.important);
  } else if (filters.bucket === "noise") {
    conditions.push(sql`not (${BUCKET_SQL.invoices})`);
    conditions.push(sql`not (${BUCKET_SQL.important})`);
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

/**
 * Batch : pour une liste de thread ids, retourne le map threadId → projets liés.
 * Utilisé par la liste emails pour afficher un chip projet sur chaque ligne
 * sans lancer une query par ligne.
 */
export async function getProjectsForThreads(
  threadIds: string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const out = new Map<string, Array<{ id: string; name: string }>>();
  if (threadIds.length === 0) return out;
  const conn = await db();
  const rows = await conn
    .select({
      threadId: gmailThreadTags.threadId,
      projectId: projects.id,
      name: projects.name,
    })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .innerJoin(projects, eq(projects.id, gmailTags.targetId))
    .where(
      and(
        inArray(gmailThreadTags.threadId, threadIds),
        eq(gmailTags.kind, "project"),
        isNull(gmailThreadTags.dismissedAt),
      ),
    );
  for (const r of rows) {
    const arr = out.get(r.threadId) ?? [];
    arr.push({ id: r.projectId, name: r.name });
    out.set(r.threadId, arr);
  }
  return out;
}

/** Une liaison active du thread (projet / contact / entité / système). */
export type ThreadLinkRow = {
  linkId: string;
  labelId: string;
  kind: "project" | "contact" | "entity" | "category";
  targetId: string | null;
  labelName: string;
  source: string;
  manuallyOverridden: boolean;
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
    extractionMeta: ExtractionMeta | null;
  }>;
  links: ThreadLinkRow[];
};

export type ExtractionMeta = {
  summary: string;
  intent: "info" | "request" | "fyi" | "decision" | "follow_up" | "compta" | "admin" | "other";
  pipelineStage: "lead" | "opportunity" | "project" | "none";
  needsReply: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getThreadDetail(threadIdLocal: string): Promise<ThreadDetail | null> {
  // Guard : cette fonction attend l'uuid local du thread. Un id Gmail brut
  // (16 hex) casserait postgres ("invalid input syntax for type uuid").
  // On no-op silencieusement plutôt que planter — utile pour les URLs
  // legacy et pour tout appelant qui passerait la mauvaise clé.
  if (!UUID_RE.test(threadIdLocal)) return null;

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
    conn
      .select({
        linkId: gmailThreadTags.id,
        labelId: gmailTags.id,
        kind: gmailTags.kind,
        targetId: gmailTags.targetId,
        labelName: gmailTags.labelName,
        source: gmailThreadTags.source,
        manuallyOverridden: gmailThreadTags.manuallyOverridden,
      })
      .from(gmailThreadTags)
      .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
      .where(and(eq(gmailThreadTags.threadId, threadIdLocal), isNull(gmailThreadTags.dismissedAt)))
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
      extractionMeta: (m.extractionMeta as ExtractionMeta | null) ?? null,
    })),
    links: linkRows,
  };
}

/**
 * Compte les threads par segment (important / invoices / noise) pour
 * afficher les badges dans les onglets. Une seule requête, filtres
 * mutuellement exclusifs (cf. BUCKET_SQL).
 */
export async function countBuckets(
  userId: string,
): Promise<{ important: number; invoices: number; noise: number; total: number }> {
  const conn = await db();
  const [row] = await conn
    .select({
      important: sql<number>`count(*) filter (
        where not (${BUCKET_SQL.invoices}) and (${BUCKET_SQL.important})
      )::int`,
      invoices: sql<number>`count(*) filter (where (${BUCKET_SQL.invoices}))::int`,
      noise: sql<number>`count(*) filter (
        where not (${BUCKET_SQL.invoices}) and not (${BUCKET_SQL.important})
      )::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(gmailThreads)
    .where(eq(gmailThreads.userId, userId));
  return {
    important: row?.important ?? 0,
    invoices: row?.invoices ?? 0,
    noise: row?.noise ?? 0,
    total: row?.total ?? 0,
  };
}

/**
 * Batch : pour une liste de thread ids, retourne le map threadId → sens
 * des factures détectées dessus. Un thread peut porter les deux (mail
 * comptable avec une facture fournisseur et une facture client en PJ).
 */
export async function getInvoiceDirectionsForThreads(
  threadIds: string[],
): Promise<Map<string, InvoiceDirectionFilter[]>> {
  const out = new Map<string, InvoiceDirectionFilter[]>();
  if (threadIds.length === 0) return out;
  const conn = await db();
  const rows = await conn
    .selectDistinct({
      threadId: gmailMessages.threadId,
      direction: invoiceFilings.direction,
    })
    .from(invoiceFilings)
    .innerJoin(gmailMessages, eq(gmailMessages.id, invoiceFilings.messageId))
    .where(
      and(inArray(gmailMessages.threadId, threadIds), ne(invoiceFilings.direction, "unknown")),
    );
  for (const r of rows) {
    if (r.direction === "unknown") continue;
    const arr = out.get(r.threadId) ?? [];
    arr.push(r.direction);
    out.set(r.threadId, arr);
  }
  return out;
}

/**
 * Compte les threads du bucket facturation par sens, pour les sous-filtres
 * "Achats / Ventes". `unclassified` = threads facturation sans PJ
 * classifiée (mail compta sans pièce jointe, PJ encore en attente).
 */
export async function countInvoiceDirections(userId: string): Promise<{
  purchase: number;
  sale: number;
  unclassified: number;
}> {
  const conn = await db();
  const purchaseSql = invoiceDirectionSql("purchase");
  const saleSql = invoiceDirectionSql("sale");
  const [row] = await conn
    .select({
      purchase: sql<number>`count(*) filter (where ${purchaseSql})::int`,
      sale: sql<number>`count(*) filter (where ${saleSql})::int`,
      unclassified: sql<number>`count(*) filter (
        where not (${purchaseSql}) and not (${saleSql})
      )::int`,
    })
    .from(gmailThreads)
    .where(and(eq(gmailThreads.userId, userId), BUCKET_SQL.invoices));
  return {
    purchase: row?.purchase ?? 0,
    sale: row?.sale ?? 0,
    unclassified: row?.unclassified ?? 0,
  };
}

export async function countThreadsForSubject(
  linkKind: "project" | "contact" | "entity",
  linkId: string,
): Promise<number> {
  const conn = await db();

  if (linkKind === "contact") {
    const [contact] = await conn
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, linkId))
      .limit(1);
    if (!contact?.email) return 0;
    const email = contact.email.toLowerCase();
    const [row] = await conn
      .select({ n: sql<number>`count(distinct ${gmailMessages.threadId})::int` })
      .from(gmailMessages)
      .where(
        sql`(
          lower(${gmailMessages.fromEmail}) = ${email}
          or ${email} = any(${gmailMessages.toEmails})
          or ${email} = any(${gmailMessages.ccEmails})
        )`,
      );
    return row?.n ?? 0;
  }

  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(
      and(
        eq(gmailTags.kind, linkKind),
        eq(gmailTags.targetId, linkId),
        isNull(gmailThreadTags.dismissedAt),
      ),
    );
  return row?.n ?? 0;
}
