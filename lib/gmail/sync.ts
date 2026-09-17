import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { gmailMessages, gmailSyncState, gmailThreads } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import {
  type GmailMessage,
  collectAttachments,
  extractBodies,
  getHeader,
  getMessage,
  internalDateToDate,
  listHistory,
  listMessages,
  parseAddressList,
} from "@/lib/google/gmail-api";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { GENERIC_EMAIL_DOMAINS, domainFromEmail, extractDomain } from "./domain";
import { extractAndSaveEmailProposals } from "./extract-and-save";
import { looksLikeInvoiceMessage } from "./invoice-detect";
import { processInvoiceFiling, queueInvoiceCandidates } from "./invoice-filer";
import {
  autoLinkThreadByParticipants,
  loadGmailLabelCache,
  pushThreadLabelsToGmail,
  syncThreadLabelsFromGmail,
} from "./links";

// `-in:spam -in:trash` exclut les emails dans la corbeille et le dossier
// spam de Gmail. `-in:promotions` filtre l'onglet Promotions (newsletters
// marketing) — désactivable plus tard si on veut le contexte client.
const BOOTSTRAP_QUERY = "newer_than:90d -in:spam -in:trash";
const MAX_MESSAGES_PER_RUN = 50;
const SLEEP_MS_BETWEEN_CALLS = 100;
/** Labels Gmail qui causent un skip silencieux à l'ingestion. */
export const SKIP_LABELS = new Set(["SPAM", "TRASH"]);
/**
 * Cap LLM extractions par run pour borner le temps (chaque extraction
 * ~2-3s) et le coût. Les messages restant en `pending` seront repris
 * au prochain sync.
 */
const MAX_EXTRACTIONS_PER_RUN = 10;
/** Cap classement de factures par run (chaque appel = download PJ + LLM + upload ~10s). */
const MAX_INVOICE_FILINGS_PER_RUN = 5;

/**
 * Rattrapage des factures passées entre les mailles : mails à PDF de la
 * fenêtre du bootstrap, plafonnés par run (cf. `recoverMissedInvoices`).
 */
const INVOICE_RECOVERY_QUERY = "newer_than:90d has:attachment filename:pdf -in:spam -in:trash";
/**
 * Seconde passe de rattrapage : les PJ dont le NOM dit facture, quel que
 * soit le sujet du mail. Paddle envoie « Payment confirmed » avec
 * `invoice_5475-94177_DataForSEO.pdf` en pièce jointe — le nom du fichier
 * est le seul signal, et il ne se lit sur aucun message `format=metadata`.
 * Ces mails court-circuitent donc `looksLikeInvoiceMessage`, que leur
 * sujet muet ferait échouer.
 */
const INVOICE_FILENAME_QUERY =
  "newer_than:90d -in:spam -in:trash {filename:invoice filename:facture filename:receipt filename:quittance}";
const MAX_INVOICE_RECOVERIES_PER_RUN = 15;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type GmailSyncResult = {
  /** Sync ignoré : une autre synchronisation tient déjà le verrou. */
  skipped?: "already_running";
  mode: "bootstrap" | "incremental";
  inserted: number;
  updated: number;
  bodiesFetched: number;
  /** 404 Gmail = messages disparus entre list et get. Compté à part
   *  pour ne pas polluer `errors[]` avec un cas attendu. */
  skippedNotFound: number;
  /** Messages skip parce qu'ils ont un label SPAM ou TRASH. */
  skippedSpam: number;
  /** Extractions LLM réussies sur ce run. */
  extractionsDone: number;
  /** Extractions skip (pas de body, sensitive detected, désactivé…). */
  extractionsSkipped: number;
  /** Total des propositions créées (toutes extractions confondues). */
  proposalsCreated: number;
  /** Messages ingérés pour leurs PJ sur le seul signal facture (sujet, expéditeur, libellé). */
  invoiceCandidatesIngested: number;
  /** Mails à PDF repris par le rattrapage factures (cf. `recoverMissedInvoices`). */
  invoicesRecovered: number;
  /** Factures PDF classées avec succès sur ce run. */
  invoicesFiled: number;
  /** Factures de VENTE détectées et taguées (non classées — cf. Dougs). */
  invoiceSalesDetected: number;
  /** Factures écartées (non-facture, champs manquants, confidence faible…). */
  invoicesRejected: number;
  /** Erreurs techniques pendant le classement (download/upload/LLM). */
  invoicesErrored: number;
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
 * Signal facture sur un message metadata — cf. `looksLikeInvoiceMessage`.
 * `labelNamesById` traduit les labelIds Gmail en noms (« factures »…).
 */
function messageLooksLikeInvoice(
  message: GmailMessage,
  labelNamesById: Map<string, string>,
): boolean {
  return looksLikeInvoiceMessage({
    subject: getHeader(message.payload, "Subject"),
    fromEmail: parseAddressList(getHeader(message.payload, "From"))[0]?.email ?? null,
    labelNames: (message.labelIds ?? []).map((id) => labelNamesById.get(id) ?? ""),
  });
}

/** État partagé par les étapes d'ingestion d'un run de sync. */
type IngestContext = {
  userId: string;
  accessToken: string;
  matchers: { emails: Set<string>; domains: Set<string> };
  labelNamesById: Map<string, string>;
  touchedThreads: Set<string>;
  result: GmailSyncResult;
};

/**
 * Ingère un message : metadata, puis `format=full` s'il matche le CRM ou
 * porte un signal facture. Sans match CRM, le signal facture suffit à
 * déclencher le full : c'est le seul moyen de voir les PJ, et donc de
 * détecter les factures d'achat de fournisseurs inconnus du CRM. Ces
 * messages ne passent PAS en `pending` pour autant — pas d'extraction LLM
 * email, seulement le pipeline facture.
 *
 * Renvoie le message metadata, ou null s'il est ignoré (spam / trash).
 */
async function ingestMessage(
  ctx: IngestContext,
  gmailMessageId: string,
): Promise<GmailMessage | null> {
  const meta = await getMessage(ctx.accessToken, gmailMessageId, "metadata");
  // Skip silencieux des spams / trash. En bootstrap on filtre déjà via la
  // query Gmail, mais en incrémental (history.list) il n'y a pas de
  // filtre — un message qui passe en spam après ingestion pourrait
  // remonter ici, et un message ajouté directement en spam ne doit pas
  // entrer.
  if ((meta.labelIds ?? []).some((l) => SKIP_LABELS.has(l))) {
    ctx.result.skippedSpam++;
    return null;
  }
  const matched = messageMatchesCrm(meta, ctx.matchers);
  const invoiceCandidate = !matched && messageLooksLikeInvoice(meta, ctx.labelNamesById);
  if (matched || invoiceCandidate) {
    await sleep(SLEEP_MS_BETWEEN_CALLS);
    const full = await getMessage(ctx.accessToken, gmailMessageId, "full");
    await ingestFullMessage(ctx, full, matched ? "pending" : "skipped");
    if (invoiceCandidate) ctx.result.invoiceCandidatesIngested++;
  } else {
    const { threadIdLocal } = await upsertThreadAndMessage(ctx.userId, meta, null, "skipped");
    ctx.touchedThreads.add(threadIdLocal);
  }
  ctx.result.inserted++;
  return meta;
}

/** Upsert d'un message `format=full` + mise en file de ses PJ PDF (idempotent). */
async function ingestFullMessage(
  ctx: IngestContext,
  full: GmailMessage,
  extractionStatus: "skipped" | "pending",
): Promise<void> {
  ctx.result.bodiesFetched++;
  // On utilise les headers du full (plus complets).
  const { threadIdLocal, messageIdLocal } = await upsertThreadAndMessage(
    ctx.userId,
    full,
    extractBodies(full.payload),
    extractionStatus,
  );
  ctx.touchedThreads.add(threadIdLocal);
  if (!messageIdLocal) return;
  try {
    const refs = collectAttachments(full.payload);
    await queueInvoiceCandidates({ userId: ctx.userId, messageIdLocal, refs });
  } catch (err) {
    ctx.result.errors.push(
      `queue invoice ${full.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Filet de sécurité : reprend les mails à PDF récents qui n'ont produit
 * aucune ligne `invoice_filings`.
 *   - jamais ingérés (trou dans l'historique Gmail) → ingestion normale ;
 *   - ingérés sans leurs PJ alors qu'ils portent un signal facture (règles
 *     de détection plus récentes que leur ingestion, PDF en octet-stream…)
 *     → on reprend le full.
 * Un mail sans signal facture ne coûte rien après son premier passage : le
 * signal se lit sur les colonnes déjà en base, sans appel Gmail.
 */
async function recoverMissedInvoices(ctx: IngestContext): Promise<void> {
  const page = await listMessages(ctx.accessToken, {
    q: INVOICE_RECOVERY_QUERY,
    maxResults: 100,
  });
  await sleep(SLEEP_MS_BETWEEN_CALLS);
  const named = await listMessages(ctx.accessToken, {
    q: INVOICE_FILENAME_QUERY,
    maxResults: 100,
  });
  // Les PJ nommées « facture » passent devant : le plafond par run ne doit
  // pas les faire attendre derrière le balayage large.
  const trusted = new Set((named.messages ?? []).map((m) => m.id));
  const ids = [
    ...trusted,
    ...(page.messages ?? []).map((m) => m.id).filter((id) => !trusted.has(id)),
  ];
  if (ids.length === 0) return;

  const conn = await db();
  const known = await conn
    .select({
      id: gmailMessages.id,
      gmailMessageId: gmailMessages.gmailMessageId,
      subject: gmailMessages.subject,
      fromEmail: gmailMessages.fromEmail,
      labels: gmailMessages.labels,
    })
    .from(gmailMessages)
    .where(and(eq(gmailMessages.userId, ctx.userId), inArray(gmailMessages.gmailMessageId, ids)));
  const filed = known.length
    ? await conn
        .selectDistinct({ messageId: invoiceFilings.messageId })
        .from(invoiceFilings)
        .where(
          inArray(
            invoiceFilings.messageId,
            known.map((k) => k.id),
          ),
        )
    : [];
  const withFiling = new Set(filed.map((f) => f.messageId));
  const knownByGmailId = new Map(known.map((k) => [k.gmailMessageId, k]));

  let recovered = 0;
  for (const id of ids) {
    if (recovered >= MAX_INVOICE_RECOVERIES_PER_RUN) break;
    const row = knownByGmailId.get(id);
    if (row && withFiling.has(row.id)) continue;
    if (
      row &&
      !trusted.has(id) &&
      !looksLikeInvoiceMessage({
        subject: row.subject,
        fromEmail: row.fromEmail,
        labelNames: (row.labels ?? []).map((l) => ctx.labelNamesById.get(l) ?? ""),
      })
    ) {
      continue;
    }
    try {
      if (row) {
        const full = await getMessage(ctx.accessToken, id, "full");
        await ingestFullMessage(ctx, full, "skipped");
      } else {
        await ingestMessage(ctx, id);
      }
      recovered++;
      ctx.result.invoicesRecovered++;
      await sleep(SLEEP_MS_BETWEEN_CALLS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Gmail API 404")) {
        ctx.result.skippedNotFound++;
        continue;
      }
      ctx.result.errors.push(`recover ${id}: ${msg}`);
    }
  }
}

/**
 * Upsert thread + message en base. Si le thread existe déjà, met à jour
 * les champs agrégés (last_message_at, message_count, snippet, labels,
 * participants). Renvoie l'id local du thread pour les hooks downstream
 * (autoLinkThread).
 */
export async function upsertThreadAndMessage(
  userId: string,
  metaMessage: GmailMessage,
  body: { text: string | null; html: string | null } | null,
  extractionStatus: "skipped" | "pending",
): Promise<{ threadIdLocal: string; messageIdLocal: string | null; isNewMessage: boolean }> {
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

  return {
    threadIdLocal,
    messageIdLocal: inserted[0]?.id ?? null,
    isNewMessage: inserted.length > 0,
  };
}

/**
 * Sync incrémental. Si aucun historyId en base → bootstrap : 3 derniers
 * mois paginés sur N runs cron. Sinon : `history.list` depuis le cursor.
 * Cap MAX_MESSAGES_PER_RUN par exécution.
 */
const SYNC_LOCK_TTL_MS = 10 * 60_000;

/**
 * Verrou applicatif : une seule sync par utilisateur à la fois (bouton
 * « Sync now » vs cron). Deux runs concurrents enverraient les mêmes
 * messages au LLM (facturé deux fois) et se marcheraient dessus sur les
 * propositions. Ligne `gmail_sync_state` créée si absente ; le verrou
 * expire tout seul après 10 min si un run est tué par Vercel.
 */
async function acquireSyncLock(userId: string): Promise<boolean> {
  const conn = await db();
  await conn.insert(gmailSyncState).values({ userId }).onConflictDoNothing();
  const rows = await conn
    .update(gmailSyncState)
    .set({ syncStartedAt: new Date() })
    .where(
      and(
        eq(gmailSyncState.userId, userId),
        or(
          isNull(gmailSyncState.syncStartedAt),
          lt(gmailSyncState.syncStartedAt, new Date(Date.now() - SYNC_LOCK_TTL_MS)),
        ),
      ),
    )
    .returning({ userId: gmailSyncState.userId });
  return rows.length > 0;
}

async function releaseSyncLock(userId: string): Promise<void> {
  const conn = await db();
  await conn
    .update(gmailSyncState)
    .set({ syncStartedAt: null })
    .where(eq(gmailSyncState.userId, userId));
}

export async function syncIncremental(userId: string): Promise<GmailSyncResult> {
  if (!(await acquireSyncLock(userId))) {
    return { ...emptySyncResult(), skipped: "already_running" };
  }
  try {
    return await syncIncrementalUnlocked(userId);
  } finally {
    await releaseSyncLock(userId);
  }
}

function emptySyncResult(): GmailSyncResult {
  return {
    mode: "incremental",
    inserted: 0,
    updated: 0,
    bodiesFetched: 0,
    skippedNotFound: 0,
    skippedSpam: 0,
    extractionsDone: 0,
    extractionsSkipped: 0,
    proposalsCreated: 0,
    invoiceCandidatesIngested: 0,
    invoicesRecovered: 0,
    invoicesFiled: 0,
    invoiceSalesDetected: 0,
    invoicesRejected: 0,
    invoicesErrored: 0,
    errors: [],
    newHistoryId: null,
    hasMore: false,
  };
}

async function syncIncrementalUnlocked(userId: string): Promise<GmailSyncResult> {
  const result: GmailSyncResult = {
    mode: "incremental",
    inserted: 0,
    updated: 0,
    bodiesFetched: 0,
    skippedNotFound: 0,
    skippedSpam: 0,
    extractionsDone: 0,
    extractionsSkipped: 0,
    proposalsCreated: 0,
    invoiceCandidatesIngested: 0,
    invoicesRecovered: 0,
    invoicesFiled: 0,
    invoiceSalesDetected: 0,
    invoicesRejected: 0,
    invoicesErrored: 0,
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

  // Cache labels.list partagé par le run (1 appel) : sert à lire les
  // libellés Gmail de l'utilisateur (signal facture) puis à la sync des
  // liaisons au step 4.
  let labelCache: Awaited<ReturnType<typeof loadGmailLabelCache>>;
  try {
    labelCache = await loadGmailLabelCache(accessToken);
  } catch (err) {
    result.errors.push(`labels cache: ${err instanceof Error ? err.message : String(err)}`);
    labelCache = new Map();
  }
  const labelNamesById = new Map([...labelCache].map(([name, id]) => [id, name]));

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
        // On ne lit que les ajouts de messages (seul type exploité) et on
        // pagine : avant, tout ce qui dépassait la 1re page ou le cap était
        // perdu, le curseur sautant au `historyId` courant de la boîte. En
        // cas de cap, le curseur s'arrête au dernier record consommé et le
        // run suivant reprend là.
        const seen = new Set<string>();
        let pageToken: string | undefined;
        let mailboxHistoryId: string | undefined;
        let lastRecordId: string | undefined;
        let capped = false;
        do {
          const page = await listHistory(accessToken, startHistoryId, {
            pageToken,
            historyTypes: ["messageAdded"],
          });
          mailboxHistoryId = page.historyId ?? mailboxHistoryId;
          for (const h of page.history ?? []) {
            for (const a of h.messagesAdded ?? []) {
              if (seen.has(a.message.id)) continue;
              seen.add(a.message.id);
              messageIds.push({ id: a.message.id, threadId: a.message.threadId });
            }
            lastRecordId = h.id;
            if (messageIds.length >= MAX_MESSAGES_PER_RUN) {
              capped = true;
              break;
            }
          }
          pageToken = capped ? undefined : page.nextPageToken;
        } while (pageToken);
        const cursor = capped ? lastRecordId : mailboxHistoryId;
        if (cursor) touchedHistoryId = Number(cursor);
        result.hasMore = capped;
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
  const ctx: IngestContext = {
    userId,
    accessToken,
    matchers,
    labelNamesById,
    touchedThreads,
    result,
  };
  for (const m of toFetch) {
    try {
      const meta = await ingestMessage(ctx, m.id);
      if (!meta) continue;
      // Bootstrap uniquement : le curseur suit le historyId max vu. En
      // incrémental il est fixé par history.list — le pousser au historyId
      // d'un message sauterait des records pas encore lus.
      if (isBootstrap && meta.historyId) {
        const h = Number(meta.historyId);
        if (!touchedHistoryId || h > touchedHistoryId) touchedHistoryId = h;
      }
      await sleep(SLEEP_MS_BETWEEN_CALLS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 Gmail = message disparu entre listMessages et getMessage
      // (spam auto-purgé, suppression manuelle, archivage par filtre).
      // Attendu en pratique → skip silencieusement.
      if (msg.includes("Gmail API 404")) {
        result.skippedNotFound++;
        continue;
      }
      result.errors.push(`message ${m.id}: ${msg}`);
    }
  }

  // ─── 3bis. Rattrapage des factures passées entre les mailles ──────
  // Hors bootstrap, qui balaie déjà toute la fenêtre.
  if (!isBootstrap) {
    try {
      await recoverMissedInvoices(ctx);
    } catch (err) {
      result.errors.push(`recover invoices: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── 4. Lie les threads touchés ──────────────────────────────────
  // (a) Auto-link par participants : pose les liaisons project/contact/
  //     entity non ambiguës côté Paradeos (idempotent, et sans jamais
  //     rétablir une liaison que l'utilisateur a invalidée).
  // (b) Sync labels Gmail → liaisons : lit les labels Gmail du thread,
  //     insère une liaison pour chaque label Paradeos/ déjà connu.
  for (const tid of touchedThreads) {
    try {
      await autoLinkThreadByParticipants(tid);
    } catch (err) {
      result.errors.push(`autolink ${tid}: ${err instanceof Error ? err.message : String(err)}`);
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
    // Projette les liaisons actives en labels Gmail, pour que le
    // rapprochement soit visible directement dans Gmail.
    try {
      await pushThreadLabelsToGmail({
        userId,
        threadIdLocal: tid,
        cache: labelCache,
        accessToken,
      });
    } catch (err) {
      result.errors.push(`push labels ${tid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── 4bis. Extraction LLM des messages en `pending` ────────────────
  // On limite à MAX_EXTRACTIONS_PER_RUN pour borner le coût et le temps
  // de sync. Les messages non-traités cette fois seront repris au sync
  // suivant (extraction_status='pending' reste indexé).
  const extractionEnabled = (await getSetting(SETTING_KEYS.GMAIL_EXTRACTION_ENABLED)) !== "false";
  if (extractionEnabled) {
    const pendingMessages = await conn
      .select({ id: gmailMessages.id })
      .from(gmailMessages)
      .where(and(eq(gmailMessages.userId, userId), eq(gmailMessages.extractionStatus, "pending")))
      .limit(MAX_EXTRACTIONS_PER_RUN);
    for (const pm of pendingMessages) {
      try {
        const r = await extractAndSaveEmailProposals(pm.id);
        if (r.skipped) {
          result.extractionsSkipped++;
        } else {
          result.extractionsDone++;
          result.proposalsCreated += r.count;
        }
        await sleep(SLEEP_MS_BETWEEN_CALLS);
      } catch (err) {
        result.errors.push(`extract ${pm.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ─── 4ter. Classement automatique des factures (kill switch) ─────
  const filingEnabled = (await getSetting(SETTING_KEYS.INVOICE_FILING_ENABLED)) !== "false";
  if (filingEnabled) {
    // Les `pending` déjà passés au LLM (confiance faible) attendent une
    // validation manuelle dans l'inbox : les reprendre ici les ferait
    // repasser au LLM à chaque run et boucherait la file pour les autres.
    const pendingFilings = await conn
      .select({ id: invoiceFilings.id })
      .from(invoiceFilings)
      .where(
        and(
          eq(invoiceFilings.userId, userId),
          eq(invoiceFilings.status, "pending"),
          isNull(invoiceFilings.confidence),
        ),
      )
      .orderBy(invoiceFilings.createdAt)
      .limit(MAX_INVOICE_FILINGS_PER_RUN);
    for (const pf of pendingFilings) {
      try {
        const r = await processInvoiceFiling(pf.id);
        if (r.direction === "sale") result.invoiceSalesDetected++;
        if (r.status === "filed") result.invoicesFiled++;
        else if (r.status === "rejected") result.invoicesRejected++;
        else result.invoicesErrored++;
      } catch (err) {
        result.invoicesErrored++;
        result.errors.push(
          `file invoice ${pf.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
 * Supprime les threads dont TOUS les messages ont un label SPAM ou
 * TRASH. Utilisé pour nettoyer les emails déjà importés avant qu'on
 * ajoute le filtrage à l'ingestion.
 */
export async function cleanupSpamThreads(userId: string): Promise<{ deletedThreads: number }> {
  const conn = await db();
  // 1. Récupère les thread_ids dont CHAQUE message est SPAM ou TRASH.
  const rows = await conn.execute<{ thread_id: string }>(sql`
    select thread_id
    from public.gmail_messages
    where user_id = ${userId}
    group by thread_id
    having bool_and('SPAM' = any(labels) or 'TRASH' = any(labels))
  `);
  const threadIds = (rows as unknown as Array<{ thread_id: string }>).map((r) => r.thread_id);
  if (threadIds.length === 0) return { deletedThreads: 0 };
  // 2. Delete cascade : messages + thread_tags partent avec le thread.
  await conn.delete(gmailThreads).where(inArray(gmailThreads.id, threadIds));
  return { deletedThreads: threadIds.length };
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
