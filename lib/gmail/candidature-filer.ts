import "server-only";

import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { candidatureReplies } from "@/db/schema/candidature-replies";
import { gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { getHeader, getMessage, sendGmailMessage } from "@/lib/google/gmail-api";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { archiveThread } from "./archive";
import { classifyCandidature } from "./candidature-classify";
import {
  firstNameFromSender,
  isOwnOrAutomatedSender,
  looksLikeCandidatureMessage,
} from "./candidature-detect";
import {
  candidatureReplySubject,
  DEFAULT_CANDIDATURE_REPLY_BODY,
  DEFAULT_CANDIDATURE_REPLY_FROM,
  renderCandidatureReply,
} from "./candidature-reply";
import { markThreadCandidature } from "./links";
import { parseEmailThread } from "./thread-parse";

/**
 * Agent candidatures. Trois étapes, toutes idempotentes :
 *   1. `queueCandidature` : le sync a repéré un mail (règles sur le sujet /
 *      le libellé) et a téléchargé son corps → ligne `pending` ;
 *   2. `processCandidatureReply` : gardes (fil déjà traité, pas de corps,
 *      trop vieux), confirmation LLM, envoi de la réponse dans le fil,
 *      libellé Paradeos/Candidature, archivage ;
 *   3. `recoverMissedCandidatures` : rattrape les mails déjà en base en
 *      métadonnées seules (ingérés avant que l'agent existe).
 *
 * Un fil ne reçoit jamais deux réponses, et on ne répond qu'aux mails
 * récents : une candidature de six mois qui remonte par un rattrapage
 * n'a plus besoin de réponse.
 */

/** Au-delà, un mail repéré est écarté sans réponse. */
export const CANDIDATURE_MAX_AGE_DAYS = 30;
/** En dessous, le LLM n'est pas assez sûr : on écarte, on n'envoie rien. */
const MIN_CONFIDENCE = 0.75;

export async function isCandidatureAutoReplyEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.CANDIDATURE_AUTOREPLY_ENABLED)) !== "false";
}

export async function queueCandidature(args: {
  userId: string;
  messageIdLocal: string;
  threadIdLocal: string;
  fromEmail: string | null;
  fromName: string | null;
}): Promise<boolean> {
  const conn = await db();
  const rows = await conn
    .insert(candidatureReplies)
    .values({
      userId: args.userId,
      messageId: args.messageIdLocal,
      threadId: args.threadIdLocal,
      candidateEmail: args.fromEmail,
      candidateName: args.fromName,
    })
    .onConflictDoNothing()
    .returning({ id: candidatureReplies.id });
  return rows.length > 0;
}

export type CandidatureReplyOutcome = {
  status: "replied" | "rejected" | "error";
  reason?: string;
};

export async function processCandidatureReply(replyId: string): Promise<CandidatureReplyOutcome> {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(candidatureReplies)
    .where(eq(candidatureReplies.id, replyId))
    .limit(1);
  if (!row) throw new Error("Candidature introuvable.");
  if (row.status === "replied") return { status: "replied" };
  if (row.status === "rejected") return { status: "rejected", reason: row.reason ?? undefined };

  const [msg] = await conn
    .select({
      gmailMessageId: gmailMessages.gmailMessageId,
      subject: gmailMessages.subject,
      fromEmail: gmailMessages.fromEmail,
      fromName: gmailMessages.fromName,
      bodyText: gmailMessages.bodyText,
      bodyHtml: gmailMessages.bodyHtml,
      internalDate: gmailMessages.internalDate,
      gmailThreadId: gmailThreads.gmailThreadId,
    })
    .from(gmailMessages)
    .innerJoin(gmailThreads, eq(gmailThreads.id, gmailMessages.threadId))
    .where(eq(gmailMessages.id, row.messageId))
    .limit(1);
  if (!msg) return markError(row.id, "message Gmail introuvable.");

  // ─── Gardes sans appel réseau ─────────────────────────────────────
  if (isOwnOrAutomatedSender(msg.fromEmail)) {
    return reject(row.id, "expéditeur interne ou automate.");
  }
  if (
    msg.internalDate &&
    Date.now() - msg.internalDate.getTime() > CANDIDATURE_MAX_AGE_DAYS * 86_400_000
  ) {
    return reject(row.id, `mail de plus de ${CANDIDATURE_MAX_AGE_DAYS} jours, pas de réponse.`);
  }
  const [alreadyReplied] = await conn
    .select({ id: candidatureReplies.id })
    .from(candidatureReplies)
    .where(
      and(eq(candidatureReplies.threadId, row.threadId), eq(candidatureReplies.status, "replied")),
    )
    .limit(1);
  if (alreadyReplied) return reject(row.id, "fil déjà répondu.");
  // Le même candidat qui ouvre un second fil (« candidature actualisée »)
  // a déjà sa réponse : la lui renvoyer ferait automate.
  if (msg.fromEmail) {
    const [sameCandidate] = await conn
      .select({ repliedAt: candidatureReplies.repliedAt })
      .from(candidatureReplies)
      .where(
        and(
          eq(candidatureReplies.userId, row.userId),
          eq(candidatureReplies.status, "replied"),
          eq(candidatureReplies.candidateEmail, msg.fromEmail),
          gt(
            candidatureReplies.repliedAt,
            new Date(Date.now() - CANDIDATURE_MAX_AGE_DAYS * 86_400_000),
          ),
        ),
      )
      .limit(1);
    if (sameCandidate) {
      return reject(
        row.id,
        `candidat déjà répondu le ${sameCandidate.repliedAt?.toLocaleDateString("fr-FR") ?? "?"}.`,
      );
    }
  }
  // Un fil où nous avons déjà écrit (à la main ou par l'agent) ne reçoit
  // pas la réponse type : la conversation est engagée.
  const [ourMessage] = await conn
    .select({ id: gmailMessages.id })
    .from(gmailMessages)
    .where(
      and(
        eq(gmailMessages.threadId, row.threadId),
        sql`${gmailMessages.labels} @> ARRAY['SENT']::text[]`,
      ),
    )
    .limit(1);
  if (ourMessage) return reject(row.id, "nous avons déjà écrit dans ce fil.");

  const parsed = parseEmailThread({ bodyText: msg.bodyText, bodyHtml: msg.bodyHtml });
  const bodyText = parsed.cleanText || msg.bodyText || "";
  if (!bodyText.trim()) return markError(row.id, "corps du mail absent.");

  // ─── Confirmation LLM ─────────────────────────────────────────────
  let verdict: Awaited<ReturnType<typeof classifyCandidature>>;
  try {
    verdict = await classifyCandidature({
      subject: msg.subject,
      fromName: msg.fromName,
      fromEmail: msg.fromEmail,
      bodyText,
      attachmentNames: [],
    });
  } catch (err) {
    return markError(row.id, `LLM : ${err instanceof Error ? err.message : String(err)}`);
  }
  await conn
    .update(candidatureReplies)
    .set({ confidence: verdict.confidence.toFixed(3), reason: verdict.summary })
    .where(eq(candidatureReplies.id, row.id));
  if (!verdict.isCandidature || verdict.confidence < MIN_CONFIDENCE) {
    return reject(
      row.id,
      `pas une candidature selon le LLM (confiance ${verdict.confidence.toFixed(2)}) : ${verdict.summary}`,
    );
  }

  // ─── Envoi de la réponse dans le fil ──────────────────────────────
  const accessToken = await getValidAccessToken(row.userId);
  if (!accessToken) return markError(row.id, "pas d'access token Google.");

  let inReplyToHeader: string | null = null;
  let replyTo: string | null = msg.fromEmail;
  try {
    const source = await getMessage(accessToken, msg.gmailMessageId, "metadata");
    inReplyToHeader = getHeader(source.payload, "Message-ID");
    const replyToHeader = getHeader(source.payload, "Reply-To");
    const match = replyToHeader?.match(/<([^>]+)>/);
    if (replyToHeader) replyTo = (match?.[1] ?? replyToHeader).trim();
  } catch {
    // Sans Message-ID, Gmail threade quand même via threadId + « Re: ».
  }
  if (!replyTo) return markError(row.id, "destinataire de la réponse introuvable.");

  const template =
    (await getSetting(SETTING_KEYS.CANDIDATURE_REPLY_BODY)) ?? DEFAULT_CANDIDATURE_REPLY_BODY;
  const from =
    (await getSetting(SETTING_KEYS.CANDIDATURE_REPLY_FROM)) ?? DEFAULT_CANDIDATURE_REPLY_FROM;
  const firstName = verdict.firstName?.trim() || firstNameFromSender(msg.fromName);
  const body = renderCandidatureReply(template, firstName);

  let sentId: string;
  try {
    const sent = await sendGmailMessage(accessToken, {
      to: replyTo,
      from,
      subject: candidatureReplySubject(msg.subject),
      body,
      gmailThreadId: msg.gmailThreadId,
      inReplyToHeader,
    });
    sentId = sent.id;
  } catch (err) {
    return markError(row.id, `envoi : ${err instanceof Error ? err.message : String(err)}`);
  }

  await conn
    .update(candidatureReplies)
    .set({
      status: "replied",
      sentGmailMessageId: sentId,
      candidateName: firstName ? (msg.fromName ?? firstName) : msg.fromName,
      errorMessage: null,
      repliedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(candidatureReplies.id, row.id));

  // Libellé + archivage : best-effort, la réponse est déjà partie.
  try {
    await markThreadCandidature({ userId: row.userId, threadIdLocal: row.threadId });
  } catch (err) {
    console.warn("[candidatures] label failed", err);
  }
  try {
    await archiveThread({ accessToken, threadIdLocal: row.threadId });
  } catch (err) {
    console.warn("[candidatures] archive failed", err);
  }
  return { status: "replied" };
}

async function reject(id: string, reason: string): Promise<CandidatureReplyOutcome> {
  const conn = await db();
  await conn
    .update(candidatureReplies)
    .set({ status: "rejected", reason, updatedAt: new Date() })
    .where(eq(candidatureReplies.id, id));
  return { status: "rejected", reason };
}

async function markError(id: string, message: string): Promise<CandidatureReplyOutcome> {
  const conn = await db();
  await conn
    .update(candidatureReplies)
    .set({ status: "error", errorMessage: message, updatedAt: new Date() })
    .where(eq(candidatureReplies.id, id));
  return { status: "error", reason: message };
}

/**
 * Traite les candidatures en attente d'un utilisateur, dans l'ordre
 * d'arrivée, plafonnées. Les `error` ne sont pas repris ici : ils
 * attendent un geste depuis les réglages.
 */
export async function processPendingCandidatures(
  userId: string,
  limit: number,
  /** Budget de temps de l'appelant : vrai = s'arrêter avant le prochain. */
  shouldStop: () => boolean = () => false,
): Promise<{ replied: number; rejected: number; errored: number; errors: string[] }> {
  const conn = await db();
  const pending = await conn
    .select({ id: candidatureReplies.id })
    .from(candidatureReplies)
    .where(and(eq(candidatureReplies.userId, userId), eq(candidatureReplies.status, "pending")))
    .orderBy(candidatureReplies.createdAt)
    .limit(limit);
  const stats = { replied: 0, rejected: 0, errored: 0, errors: [] as string[] };
  for (const p of pending) {
    if (shouldStop()) break;
    try {
      const r = await processCandidatureReply(p.id);
      if (r.status === "replied") stats.replied++;
      else if (r.status === "rejected") stats.rejected++;
      else {
        stats.errored++;
        if (r.reason) stats.errors.push(`candidature ${p.id}: ${r.reason}`);
      }
    } catch (err) {
      stats.errored++;
      stats.errors.push(`candidature ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

/**
 * Mails récents déjà en base qui ressemblent à une candidature mais n'ont
 * pas de ligne `candidature_replies` : ingérés avant l'agent, ou avant
 * une règle de détection plus récente. On les met en file ; si le corps
 * manque (métadonnées seules), on le télécharge d'abord via `fetchBody`.
 *
 * Sans appel Gmail de liste : le signal se lit sur les colonnes en base.
 */
export async function recoverMissedCandidatures(args: {
  userId: string;
  labelNamesById: Map<string, string>;
  limit: number;
  /** Télécharge le corps d'un message métadonnées seules. */
  fetchBody: (gmailMessageId: string) => Promise<void>;
}): Promise<{ queued: number; errors: string[] }> {
  const conn = await db();
  const since = new Date(Date.now() - CANDIDATURE_MAX_AGE_DAYS * 86_400_000);
  const recent = await conn
    .select({
      id: gmailMessages.id,
      threadId: gmailMessages.threadId,
      gmailMessageId: gmailMessages.gmailMessageId,
      subject: gmailMessages.subject,
      fromEmail: gmailMessages.fromEmail,
      fromName: gmailMessages.fromName,
      labels: gmailMessages.labels,
      hasBody: isNotNull(gmailMessages.bodyText),
    })
    .from(gmailMessages)
    .where(
      and(
        eq(gmailMessages.userId, args.userId),
        gt(gmailMessages.internalDate, since),
        eq(gmailMessages.isDraft, false),
      ),
    );
  const candidates = recent.filter((m) =>
    looksLikeCandidatureMessage({
      subject: m.subject,
      fromEmail: m.fromEmail,
      labelNames: (m.labels ?? []).map((l) => args.labelNamesById.get(l) ?? ""),
    }),
  );
  if (candidates.length === 0) return { queued: 0, errors: [] };

  const known = await conn
    .select({ messageId: candidatureReplies.messageId })
    .from(candidatureReplies)
    .where(
      inArray(
        candidatureReplies.messageId,
        candidates.map((c) => c.id),
      ),
    );
  const knownIds = new Set(known.map((k) => k.messageId));

  const stats = { queued: 0, errors: [] as string[] };
  for (const m of candidates) {
    if (stats.queued >= args.limit) break;
    if (knownIds.has(m.id)) continue;
    try {
      if (!m.hasBody) await args.fetchBody(m.gmailMessageId);
      const inserted = await queueCandidature({
        userId: args.userId,
        messageIdLocal: m.id,
        threadIdLocal: m.threadId,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
      });
      if (inserted) stats.queued++;
    } catch (err) {
      stats.errors.push(
        `recover candidature ${m.gmailMessageId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return stats;
}
