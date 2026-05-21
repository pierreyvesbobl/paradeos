import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { gmailMessages, gmailSyncState, gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import {
  type GmailMessage,
  extractBodies,
  getHeader,
  getMessage,
  internalDateToDate,
  listHistory,
  listMessages,
  parseAddressList,
} from "@/lib/google/gmail-api";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { GENERIC_EMAIL_DOMAINS, domainFromEmail, extractDomain } from "./domain";
import {
  autoTagThreadByParticipants,
  loadGmailLabelCache,
  pushThreadTagsToGmail,
  syncThreadLabelsFromGmail,
} from "./tags";

const BOOTSTRAP_QUERY = "newer_than:90d";
const MAX_MESSAGES_PER_RUN = 50;
const SLEEP_MS_BETWEEN_CALLS = 100;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type GmailSyncResult = {
  mode: "bootstrap" | "incremental";
  inserted: number;
  updated: number;
  bodiesFetched: number;
  /** 404 Gmail = messages disparus entre list et get. Compté à part
   *  pour ne pas polluer `errors[]` avec un cas attendu. */
  skippedNotFound: number;
  errors: string[];
  newHistoryId: number | null;
  hasMore: boolean;
};

/**
 * Charge l'ensemble des emails CRM connus pour décider si un message
 * mérite qu'on télécharge son body + l'extraction LLM downstream.
 *
 * Retourne deux Sets : emails normalisés en lowercase, domaines des
 * entités (filtrés des domaines génériques tels que gmail.com).
 */
async function loadCrmMatchers(): Promise<{ emails: Set<string>; domains: Set<string> }> {
  const conn = await db();
  const [contactRows, entityRows] = await Promise.all([
    conn.select({ email: contacts.email }).from(contacts).where(isNotNull(contacts.email)),
    conn.select({ website: entities.website }).from(entities).where(isNotNull(entities.website)),
  ]);
  const emails = new Set<string>();
  for (const r of contactRows) {
    if (r.email) emails.add(r.email.trim().toLowerCase());
  }
  const domains = new Set<string>();
  for (const r of entityRows) {
    const d = extractDomain(r.website);
    if (d && !GENERIC_EMAIL_DOMAINS.has(d)) domains.add(d);
  }
  return { emails, domains };
}

/**
 * Pour un message Gmail (n'importe quel format), check si l'expéditeur
 * OU un destinataire matche un email CRM ou un domaine d'entité connu.
 */
function messageMatchesCrm(
  message: GmailMessage,
  matchers: { emails: Set<string>; domains: Set<string> },
): boolean {
  const payload = message.payload;
  const allEmails = [
    ...parseAddressList(getHeader(payload, "From")),
    ...parseAddressList(getHeader(payload, "To")),
    ...parseAddressList(getHeader(payload, "Cc")),
  ];
  for (const addr of allEmails) {
    if (matchers.emails.has(addr.email)) return true;
    const dom = domainFromEmail(addr.email);
    if (dom && matchers.domains.has(dom)) return true;
  }
  return false;
}

/**
 * Upsert thread + message en base. Si le thread existe déjà, met à jour
 * les champs agrégés (last_message_at, message_count, snippet, labels,
 * participants). Renvoie l'id local du thread pour les hooks downstream
 * (autoLinkThread).
 */
async function upsertThreadAndMessage(
  userId: string,
  metaMessage: GmailMessage,
  body: { text: string | null; html: string | null } | null,
  extractionStatus: "skipped" | "pending",
): Promise<{ threadIdLocal: string; isNewMessage: boolean }> {
  const conn = await db();
  const payload = metaMessage.payload;
  const fromHeader = getHeader(payload, "From");
  const toHeader = getHeader(payload, "To");
  const ccHeader = getHeader(payload, "Cc");
  const subject = getHeader(payload, "Subject");
  const fromList = parseAddressList(fromHeader);
  const toList = parseAddressList(toHeader);
  const ccList = parseAddressList(ccHeader);
  const fromAddr = fromList[0] ?? null;
  const internalDate = internalDateToDate(metaMessage.internalDate);
  const labels = metaMessage.labelIds ?? [];
  const isDraft = labels.includes("DRAFT");
  const isUnread = labels.includes("UNREAD");

  // 1. Upsert thread (par user_id + gmail_thread_id).
  const participants = [...fromList, ...toList, ...ccList].reduce<
    Array<{ email: string; name?: string }>
  >((acc, a) => {
    if (!acc.find((x) => x.email === a.email)) acc.push(a);
    return acc;
  }, []);

  // 1. Upsert thread — toutes les colonnes overwrite. Les valeurs
  // dérivées (message_count, last_message_at, snippet) sont recalculées
  // au step 3 en agrégat. On reste simple sur les colonnes simples pour
  // éviter les expressions SQL paramétrées avec Dates qui faisaient
  // planter postgres-js.
  const [threadRow] = await conn
    .insert(gmailThreads)
    .values({
      userId,
      gmailThreadId: metaMessage.threadId,
      subject: subject ?? null,
      participants: participants as unknown as Record<string, unknown>,
      lastMessageAt: internalDate,
      snippet: metaMessage.snippet ?? null,
      messageCount: 1,
      hasUnread: isUnread,
      labels,
    })
    .onConflictDoUpdate({
      target: [gmailThreads.userId, gmailThreads.gmailThreadId],
      set: {
        subject: subject ?? null,
        snippet: metaMessage.snippet ?? null,
        labels,
        // Les autres champs (lastMessageAt, messageCount, hasUnread) sont
        // recalculés au step 3 depuis l'agrégat des messages.
        updatedAt: new Date(),
      },
    })
    .returning({ id: gmailThreads.id });
  if (!threadRow) throw new Error("Échec upsert gmail_thread");
  const threadIdLocal = threadRow.id;

  // 2. Upsert message. Full overwrite côté champs ; si on revient avec
  // un body après être passé en metadata only, c'est l'upgrade qu'on
  // veut. extractionStatus passe en "pending" si on récupère un body,
  // sinon reste "skipped". Si déjà "extracted", on ne le repasse pas en
  // arrière — géré séparément ci-dessous via une UPDATE simple.
  const inserted = await conn
    .insert(gmailMessages)
    .values({
      threadId: threadIdLocal,
      userId,
      gmailMessageId: metaMessage.id,
      fromEmail: fromAddr?.email ?? null,
      fromName: fromAddr?.name ?? null,
      toEmails: toList.map((a) => a.email),
      ccEmails: ccList.map((a) => a.email),
      subject: subject ?? null,
      snippet: metaMessage.snippet ?? null,
      bodyText: body?.text ?? null,
      bodyHtml: body?.html ?? null,
      internalDate,
      labels,
      isDraft,
      extractionStatus,
    })
    .onConflictDoUpdate({
      target: [gmailMessages.userId, gmailMessages.gmailMessageId],
      set: {
        labels,
        // Upgrade body uniquement si on a un nouveau (sinon on garde
        // l'ancien — pas de downgrade vers null).
        ...(body?.text != null ? { bodyText: body.text } : {}),
        ...(body?.html != null ? { bodyHtml: body.html } : {}),
        // Idem pour extractionStatus : on n'écrase pas "extracted" par
        // "pending"/"skipped". On laisse l'update tel quel ici ; un
        // garde-fou plus simple : on update via une 2e requête.
        updatedAt: new Date(),
      },
    })
    .returning({ id: gmailMessages.id });

  // 2bis. Upgrade extractionStatus si on vient de récupérer un body et
  // que le row n'est pas déjà extracted. UPDATE simple, plus sûr qu'une
  // expression CASE inlinée dans onConflictDoUpdate.
  if (extractionStatus === "pending") {
    await conn.execute(sql`
      update public.gmail_messages
      set extraction_status = 'pending'::gmail_extraction_status
      where user_id = ${userId}
        and gmail_message_id = ${metaMessage.id}
        and extraction_status = 'skipped'
    `);
  }

  // 3. Recalcule l'agrégat thread (count + last_message_at + snippet).
  await conn.execute(sql`
    update public.gmail_threads gt
    set message_count = sub.cnt,
        last_message_at = sub.last_at,
        snippet = sub.last_snippet,
        updated_at = now()
    from (
      select count(*)::int as cnt,
             max(internal_date) as last_at,
             (select snippet from public.gmail_messages
              where thread_id = ${threadIdLocal}
              order by internal_date desc nulls last
              limit 1) as last_snippet
      from public.gmail_messages
      where thread_id = ${threadIdLocal}
    ) sub
    where gt.id = ${threadIdLocal}
  `);

  return { threadIdLocal, isNewMessage: inserted.length > 0 };
}

/**
 * Sync incrémental. Si aucun historyId en base → bootstrap : 3 derniers
 * mois paginés sur N runs cron. Sinon : `history.list` depuis le cursor.
 * Cap MAX_MESSAGES_PER_RUN par exécution.
 */
export async function syncIncremental(userId: string): Promise<GmailSyncResult> {
  const result: GmailSyncResult = {
    mode: "incremental",
    inserted: 0,
    updated: 0,
    bodiesFetched: 0,
    skippedNotFound: 0,
    errors: [],
    newHistoryId: null,
    hasMore: false,
  };

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    result.errors.push("Pas d'access token Google.");
    return result;
  }

  const conn = await db();
  const [stateRow] = await conn
    .select()
    .from(gmailSyncState)
    .where(eq(gmailSyncState.userId, userId))
    .limit(1);

  const isBootstrap = !stateRow?.lastHistoryId;
  result.mode = isBootstrap ? "bootstrap" : "incremental";

  const matchers = await loadCrmMatchers();

  // ─── 1. Récupère la liste d'IDs à traiter ─────────────────────────
  const messageIds: Array<{ id: string; threadId: string }> = [];
  let nextCursor: string | undefined;
  let touchedHistoryId: number | null = null;

  try {
    if (isBootstrap) {
      const page = await listMessages(accessToken, {
        q: BOOTSTRAP_QUERY,
        pageToken: stateRow?.bootstrapCursor ?? undefined,
        maxResults: MAX_MESSAGES_PER_RUN,
      });
      for (const m of page.messages ?? []) messageIds.push(m);
      nextCursor = page.nextPageToken;
      result.hasMore = Boolean(nextCursor);
    } else {
      // isBootstrap = false implique stateRow + lastHistoryId présents.
      const startHistoryId = stateRow?.lastHistoryId;
      if (startHistoryId == null) {
        result.errors.push(
          "État incohérent : lastHistoryId manquant alors qu'on est en incrémental.",
        );
        return result;
      }
      try {
        const page = await listHistory(accessToken, startHistoryId);
        const added: Array<{ id: string; threadId: string }> = [];
        for (const h of page.history ?? []) {
          for (const a of h.messagesAdded ?? []) {
            added.push({ id: a.message.id, threadId: a.message.threadId });
          }
        }
        // Dédup (même message peut apparaître plusieurs fois si labels changent).
        const seen = new Set<string>();
        for (const m of added) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          messageIds.push(m);
          if (messageIds.length >= MAX_MESSAGES_PER_RUN) break;
        }
        if (page.historyId) touchedHistoryId = Number(page.historyId);
        result.hasMore = added.length > MAX_MESSAGES_PER_RUN;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 = historyId trop ancien → reset bootstrap.
        if (msg.includes("404")) {
          await conn
            .insert(gmailSyncState)
            .values({ userId, lastHistoryId: null, bootstrapCursor: null, lastError: null })
            .onConflictDoUpdate({
              target: gmailSyncState.userId,
              set: {
                lastHistoryId: null,
                bootstrapCursor: null,
                lastError: null,
                updatedAt: new Date(),
              },
            });
          result.errors.push("history.list a renvoyé 404 — reset bootstrap au prochain run.");
          return result;
        }
        throw err;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`list failed: ${msg}`);
    return result;
  }

  // ─── 2. Skip les messages déjà connus ─────────────────────────────
  if (messageIds.length === 0) {
    // Pas de nouveaux messages — on persiste juste l'historyId si on en a un.
    if (touchedHistoryId) result.newHistoryId = touchedHistoryId;
  }
  const existing = messageIds.length
    ? await conn
        .select({ id: gmailMessages.gmailMessageId })
        .from(gmailMessages)
        .where(
          inArray(
            gmailMessages.gmailMessageId,
            messageIds.map((m) => m.id),
          ),
        )
    : [];
  const existingIds = new Set(existing.map((e) => e.id));
  const toFetch = messageIds.filter((m) => !existingIds.has(m.id));

  // ─── 3. Pour chaque nouveau message : metadata → match? → full ────
  const touchedThreads = new Set<string>();
  for (const m of toFetch) {
    try {
      const meta = await getMessage(accessToken, m.id, "metadata");
      const matched = messageMatchesCrm(meta, matchers);

      let body: { text: string | null; html: string | null } | null = null;
      let extractionStatus: "skipped" | "pending" = "skipped";
      if (matched) {
        await sleep(SLEEP_MS_BETWEEN_CALLS);
        const full = await getMessage(accessToken, m.id, "full");
        body = extractBodies(full.payload);
        extractionStatus = "pending";
        result.bodiesFetched++;
        // On utilise les headers du full (plus complets).
        const { threadIdLocal } = await upsertThreadAndMessage(
          userId,
          full,
          body,
          extractionStatus,
        );
        touchedThreads.add(threadIdLocal);
      } else {
        const { threadIdLocal } = await upsertThreadAndMessage(userId, meta, null, "skipped");
        touchedThreads.add(threadIdLocal);
      }
      result.inserted++;
      // Track le historyId max vu (utilisé en bootstrap).
      if (meta.historyId) {
        const h = Number(meta.historyId);
        if (!touchedHistoryId || h > touchedHistoryId) touchedHistoryId = h;
      }
      await sleep(SLEEP_MS_BETWEEN_CALLS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 Gmail = message disparu entre listMessages et getMessage
      // (spam auto-purgé, suppression manuelle, archivage par filtre).
      // Attendu en pratique → skip silencieusement, on l'a marqué
      // "vu" via le track historyId du loop.
      if (msg.includes("Gmail API 404")) {
        result.skippedNotFound++;
        continue;
      }
      result.errors.push(`message ${m.id}: ${msg}`);
    }
  }

  // ─── 4. Auto-tag les threads touchés ─────────────────────────────
  // (a) Auto-tag par participants : pose les tags project/contact/entity
  //     côté Paradeos (idempotent).
  // (b) Sync labels Gmail → thread_tags : lit les labels Gmail du thread,
  //     insère un thread_tag pour chaque label Paradeos/ déjà connu.
  let labelCache: Awaited<ReturnType<typeof loadGmailLabelCache>> | null = null;
  for (const tid of touchedThreads) {
    try {
      await autoTagThreadByParticipants(tid);
    } catch (err) {
      result.errors.push(`autotag ${tid}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Pour la sync labels Gmail, on a besoin du cache labels.list (1 call
    // par run, partagé). On le construit lazy.
    if (!labelCache) {
      try {
        labelCache = await loadGmailLabelCache(accessToken);
      } catch (err) {
        result.errors.push(`labels cache: ${err instanceof Error ? err.message : String(err)}`);
        labelCache = new Map();
      }
    }
    try {
      // Récupère tous les label_ids des messages du thread (déjà stockés
      // dans gmail_messages.labels par l'upsert ci-dessus).
      const msgs = await conn
        .select({ labels: gmailMessages.labels })
        .from(gmailMessages)
        .where(eq(gmailMessages.threadId, tid));
      const allLabelIds = new Set<string>();
      for (const m of msgs) for (const l of m.labels ?? []) allLabelIds.add(l);
      await syncThreadLabelsFromGmail({
        userId,
        threadIdLocal: tid,
        gmailLabelIds: [...allLabelIds],
        cache: labelCache,
      });
    } catch (err) {
      result.errors.push(`sync labels ${tid}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Push les tags auto vers Gmail pour qu'ils soient visibles côté
    // Gmail UI (objectif : "rapprochement direct dans Gmail").
    try {
      await pushThreadTagsToGmail({
        userId,
        threadIdLocal: tid,
        cache: labelCache,
        accessToken,
      });
    } catch (err) {
      result.errors.push(`push tags ${tid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── 5. Persiste l'état de sync ────────────────────────────────────
  // Calcule les valeurs finales d'abord (sans interpolation SQL avec
  // column refs, qui causait des soucis postgres-js sur les Dates).
  const nextLastHistoryId = touchedHistoryId ?? stateRow?.lastHistoryId ?? null;
  const nextLastFullSyncAt =
    isBootstrap && !nextCursor ? new Date() : (stateRow?.lastFullSyncAt ?? null);
  const nextBootstrapCursor = isBootstrap ? (nextCursor ?? null) : null;
  const nextLastError = result.errors.length ? result.errors.slice(0, 5).join(" | ") : null;
  const nextIncrementalAt = new Date();

  await conn
    .insert(gmailSyncState)
    .values({
      userId,
      lastHistoryId: nextLastHistoryId,
      lastIncrementalAt: nextIncrementalAt,
      bootstrapCursor: nextBootstrapCursor,
      lastFullSyncAt: nextLastFullSyncAt,
      lastError: nextLastError,
    })
    .onConflictDoUpdate({
      target: gmailSyncState.userId,
      set: {
        lastHistoryId: nextLastHistoryId,
        lastIncrementalAt: nextIncrementalAt,
        bootstrapCursor: nextBootstrapCursor,
        lastFullSyncAt: nextLastFullSyncAt,
        lastError: nextLastError,
        updatedAt: new Date(),
      },
    });

  result.newHistoryId = touchedHistoryId;
  return result;
}

/**
 * Purge complète des données Gmail locales pour un user. Idempotent.
 * Le cron repartira en bootstrap au prochain run.
 */
export async function purgeGmailData(userId: string): Promise<void> {
  const conn = await db();
  // ON DELETE CASCADE sur threads → messages → links.
  await conn.delete(gmailThreads).where(eq(gmailThreads.userId, userId));
  await conn.delete(gmailSyncState).where(eq(gmailSyncState.userId, userId));
}
