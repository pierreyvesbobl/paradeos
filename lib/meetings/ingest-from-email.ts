import "server-only";

import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { getOrCreateGmailLabel, loadGmailLabelCache } from "@/lib/gmail/links";
import { extractPdfText } from "@/lib/gmail/pdf";
import { getValidAccessToken } from "@/lib/google/account";
import {
  type GmailMessage,
  collectAttachments,
  extractBodies,
  getAttachment,
  getHeader,
  getMessage,
  internalDateToDate,
  listMessages,
  modifyThreadLabels,
  parseAddressList,
} from "@/lib/google/gmail-api";
import {
  MAX_AUDIO_BYTES,
  MIN_BODY_CHARS,
  MIN_TRANSCRIPT_CHARS,
  cleanEmailBodyForTranscript,
  htmlToPlainText,
  pickTranscriptSource,
  sanitizeAudioFileName,
  titleFromSubject,
} from "@/lib/meetings/email-attachments";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import { getIngestionUserIds } from "@/lib/meetings/ingestion-user";
import { transcribeMeetingAudio } from "@/lib/meetings/transcribe";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

/**
 * Ingestion des réunions envoyées par mail.
 *
 * Le principe : un label Gmail est la file d'attente. On transfère au
 * compte Google connecté un mail portant le transcript (collé dans le
 * corps, ou en PJ texte / PDF / audio), un filtre Gmail — ou la main —
 * pose le label, et ce pipeline fait le reste : réunion créée,
 * transcription Whisper si c'est de l'audio, extraction LLM, puis label
 * retiré et remplacé par `<label>/Traité`. La boîte redevient vide :
 * ce qui reste labellisé est ce qui n'est pas passé.
 *
 * Idempotent à deux niveaux : le label retiré sort le message de la
 * file, et `meetings.source_email_message_id` (unique partiel) empêche
 * le doublon si le label revient.
 */

/** Sous-label posé une fois le mail traité. */
const PROCESSED_SEGMENT = "Traité";

/**
 * Sous-label des mails que le pipeline ne sait pas exploiter (audio trop
 * lourd, aucune matière). Ils sortent quand même de la file : laissés
 * dedans, ils reprendraient les 3 places du run à chaque passage et
 * bloqueraient les mails suivants.
 */
const IGNORED_SEGMENT = "Ignoré";

/** Valeur proposée par défaut dans l'UI de réglages. */
export const SUGGESTED_MEETINGS_EMAIL_LABEL = "Paradeos/Réunions";

/** Limite par run : un audio d'une heure peut manger tout le budget. */
const MAX_MESSAGES_PER_RUN = 3;

/**
 * Budget de temps du run, aligné sur `maxDuration = 300` de la cron
 * (cf. `ingest-from-drive.ts`). Whisper puis l'extraction sur un
 * transcript d'une heure tiennent rarement sous 90 s : on n'entame pas
 * un message de plus passé ce seuil, quitte à reprendre au run suivant.
 */
const RUN_BUDGET_MS = 200_000;

const AUDIO_BUCKET = "meeting-audio";

export type EmailIngestResult = {
  ingested: number;
  /** Parmi les ingérés, ceux passés par Whisper (audio en PJ). */
  transcribed: number;
  skippedExisting: number;
  skippedUnsupported: number;
  errors: number;
  errorDetails: string[];
};

export async function ingestEmailTranscripts(): Promise<EmailIngestResult> {
  const result: EmailIngestResult = {
    ingested: 0,
    transcribed: 0,
    skippedExisting: 0,
    skippedUnsupported: 0,
    errors: 0,
    errorDetails: [],
  };

  const labelName = await getSetting(SETTING_KEYS.MEETINGS_EMAIL_LABEL);
  if (!labelName) {
    result.errorDetails.push("MEETINGS_EMAIL_LABEL non configuré.");
    return result;
  }

  const userIds = await getIngestionUserIds();
  if (userIds.length === 0) {
    result.errorDetails.push("Aucun admin avec compte Google connecté.");
    return result;
  }

  const startedAt = Date.now();
  let processed = 0;
  let labelFoundSomewhere = false;

  // Le réglage est global mais le label vit dans une boîte : on balaie
  // les comptes admin connectés, et seul celui qui porte le label
  // travaille. Une boîte sans ce label n'est pas une erreur.
  for (const userId of userIds) {
    if (processed >= MAX_MESSAGES_PER_RUN) break;
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;

    const outcome = await ingestForUser({
      userId,
      labelName,
      result,
      startedAt,
      alreadyProcessed: processed,
    });
    if (outcome.labelFound) labelFoundSomewhere = true;
    processed += outcome.processed;
  }

  if (!labelFoundSomewhere) {
    result.errorDetails.push(
      `Label "${labelName}" introuvable dans Gmail — crée-le depuis les réglages.`,
    );
  }

  return result;
}

/**
 * Draine la file d'un compte. Rend `labelFound: false` quand cette
 * boîte n'a simplement pas le label — l'appelant décide si c'est un
 * problème (aucune boîte ne l'a) ou la normale (une autre l'a).
 */
async function ingestForUser(args: {
  userId: string;
  labelName: string;
  result: EmailIngestResult;
  startedAt: number;
  alreadyProcessed: number;
}): Promise<{ labelFound: boolean; processed: number }> {
  const { userId, labelName, result, startedAt } = args;

  let accessToken: string | null = null;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Token Google invalide : ${(err as Error).message}`);
    return { labelFound: false, processed: 0 };
  }
  if (!accessToken) return { labelFound: false, processed: 0 };

  let labelCache: Map<string, string>;
  try {
    labelCache = await loadGmailLabelCache(accessToken);
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Lecture des labels Gmail : ${(err as Error).message}`);
    return { labelFound: false, processed: 0 };
  }

  const labelId = resolveLabelId(labelCache, labelName);
  if (!labelId) return { labelFound: false, processed: 0 };

  let messageIds: Array<{ id: string; threadId: string }>;
  try {
    const listed = await listMessages(accessToken, { labelIds: [labelId], maxResults: 25 });
    messageIds = listed.messages ?? [];
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Listing du label : ${(err as Error).message}`);
    return { labelFound: true, processed: 0 };
  }

  const conn = await db();
  let processed = 0;

  for (const ref of messageIds) {
    if (args.alreadyProcessed + processed >= MAX_MESSAGES_PER_RUN) break;
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;

    const existing = await conn
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.sourceEmailMessageId, ref.id))
      .limit(1);
    if (existing.length > 0) {
      result.skippedExisting++;
      // Le message a déjà donné une réunion : on le sort de la file,
      // sinon il serait relu à chaque run jusqu'à la fin des temps.
      await markProcessed(accessToken, ref.threadId, labelName, labelId, labelCache, result);
      continue;
    }

    processed++;
    try {
      await ingestOneMessage({
        accessToken,
        userId,
        messageRef: ref,
        labelName,
        labelId,
        labelCache,
        result,
      });
    } catch (err) {
      result.errors++;
      result.errorDetails.push(`Message ${ref.id} : ${(err as Error).message}`);
    }
  }

  return { labelFound: true, processed };
}

/**
 * Gmail est sensible à la casse sur les noms de label mais les humains
 * non : on tente l'exact, puis l'insensible à la casse.
 */
function resolveLabelId(cache: Map<string, string>, labelName: string): string | null {
  const exact = cache.get(labelName);
  if (exact) return exact;
  const wanted = labelName.toLowerCase();
  for (const [name, id] of cache) {
    if (name.toLowerCase() === wanted) return id;
  }
  return null;
}

type IngestArgs = {
  accessToken: string;
  userId: string;
  messageRef: { id: string; threadId: string };
  labelName: string;
  labelId: string;
  labelCache: Map<string, string>;
  result: EmailIngestResult;
};

async function ingestOneMessage(args: IngestArgs): Promise<void> {
  const { accessToken, userId, messageRef, result } = args;
  const conn = await db();

  const message = await getMessage(accessToken, messageRef.id, "full");
  const payload = message.payload;
  const subject = getHeader(payload, "Subject");
  const fromHeader = getHeader(payload, "From");
  const fromEmail = parseAddressList(fromHeader)[0]?.email ?? null;
  const receivedAt = internalDateToDate(message.internalDate);
  const title = titleFromSubject(
    subject,
    `Réunion reçue par mail du ${(receivedAt ?? new Date()).toLocaleDateString("fr-FR")}`,
  );

  const attachments = collectAttachments(payload);
  const source = pickTranscriptSource(
    attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
  );

  // ---- Audio : on crée la réunion, on pousse le fichier, Whisper suit.
  if (source?.kind === "audio") {
    const ref = attachments.find((a) => a.filename === source.attachment.filename);
    if (!ref) throw new Error("Pièce jointe audio introuvable dans le payload.");
    if (ref.size > MAX_AUDIO_BYTES) {
      result.skippedUnsupported++;
      result.errorDetails.push(
        `"${ref.filename}" fait ${Math.round(ref.size / 1024 / 1024)} Mo — au-delà des 25 Mo acceptés par Whisper.`,
      );
      await markIgnored(args);
      return;
    }

    const meetingId = await insertMeeting(conn, {
      title,
      transcript: null,
      userId,
      messageId: messageRef.id,
      fromEmail,
      receivedAt,
    });

    const attachmentData = await getAttachment(accessToken, messageRef.id, ref.attachmentId);
    const storagePath = `${meetingId}/${crypto.randomUUID()}-${sanitizeAudioFileName(ref.filename)}`;
    await uploadAudio(storagePath, attachmentData.data, ref.mimeType);
    await conn
      .update(meetings)
      .set({
        audioStoragePath: storagePath,
        audioFileName: ref.filename,
        audioMimeType: ref.mimeType,
        audioSizeBytes: attachmentData.size,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meetingId));

    result.ingested++;
    // La réunion existe : le mail sort de la file même si la suite
    // échoue, sinon on le rejouerait sans jamais pouvoir le recréer
    // (l'unique partiel sur `source_email_message_id` le bloque).
    await markProcessed(
      accessToken,
      messageRef.threadId,
      args.labelName,
      args.labelId,
      args.labelCache,
      result,
    );

    try {
      await transcribeMeetingAudio(meetingId);
      result.transcribed++;
    } catch (err) {
      result.errors++;
      result.errorDetails.push(`Transcription "${ref.filename}" : ${(err as Error).message}`);
      // `transcription_status='error'` est déjà posé : la réunion est
      // visible dans /meetings avec un bouton pour relancer.
      return;
    }

    await runExtraction(meetingId, title, result);
    return;
  }

  // ---- Texte / PDF / corps du mail : transcript disponible tout de suite.
  const transcript = await readTextTranscript(args, message, attachments, source);
  if (!transcript) {
    result.skippedUnsupported++;
    result.errorDetails.push(
      `"${title}" : ni pièce jointe exploitable ni corps de mail assez fourni pour un transcript.`,
    );
    await markIgnored(args);
    return;
  }

  const meetingId = await insertMeeting(conn, {
    title,
    transcript,
    userId,
    messageId: messageRef.id,
    fromEmail,
    receivedAt,
  });
  result.ingested++;
  await markProcessed(
    accessToken,
    messageRef.threadId,
    args.labelName,
    args.labelId,
    args.labelCache,
    result,
  );
  await runExtraction(meetingId, title, result);
}

/**
 * Transcript textuel du message : PJ texte, PJ PDF, ou à défaut le
 * corps du mail nettoyé. Retourne `null` si rien n'atteint le seuil de
 * matière minimal.
 */
async function readTextTranscript(
  args: IngestArgs,
  message: GmailMessage,
  attachments: ReturnType<typeof collectAttachments>,
  source: ReturnType<typeof pickTranscriptSource>,
): Promise<string | null> {
  const { accessToken, messageRef } = args;

  if (source && (source.kind === "text" || source.kind === "pdf")) {
    const ref = attachments.find((a) => a.filename === source.attachment.filename);
    if (ref) {
      const { data } = await getAttachment(accessToken, messageRef.id, ref.attachmentId);
      const text =
        source.kind === "pdf" ? await extractPdfText(data) : data.toString("utf8").trim();
      if (text.trim().length >= MIN_TRANSCRIPT_CHARS) return text.trim();
    }
  }

  const bodies = extractBodies(message.payload);
  const raw = bodies.text ?? (bodies.html ? htmlToPlainText(bodies.html) : null);
  if (!raw) return null;
  const cleaned = cleanEmailBodyForTranscript(raw);
  return cleaned.length >= MIN_BODY_CHARS ? cleaned : null;
}

async function insertMeeting(
  conn: Awaited<ReturnType<typeof db>>,
  args: {
    title: string;
    transcript: string | null;
    userId: string;
    messageId: string;
    fromEmail: string | null;
    receivedAt: Date | null;
  },
): Promise<string> {
  const [row] = await conn
    .insert(meetings)
    .values({
      title: args.title,
      transcript: args.transcript,
      // La date du mail n'est pas celle de la réunion, mais elle en est
      // la meilleure approximation tant que l'extraction n'a rien dit.
      occurredAt: args.receivedAt,
      // Le label source s'affiche tel quel (fiche réunion, liste projet) :
      // on y met l'expéditeur, seule info qui dit d'où sort le transcript.
      sourceLabel: args.fromEmail ? `Email (auto) — ${args.fromEmail}` : "Email (auto)",
      sourceEmailMessageId: args.messageId,
      sourceEmailFrom: args.fromEmail,
      sourceEmailReceivedAt: args.receivedAt,
      createdBy: args.userId,
    })
    .returning({ id: meetings.id });
  if (!row?.id) throw new Error("Insert réunion sans id retourné.");
  return row.id;
}

async function runExtraction(
  meetingId: string,
  title: string,
  result: EmailIngestResult,
): Promise<void> {
  try {
    await extractAndSaveProposals(meetingId);
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Extraction "${title}" : ${(err as Error).message}`);
    // La réunion reste en status="ingested" sans propositions :
    // relançable à la main depuis /meetings/[id].
  }
}

/** Raccourci : sort de la file sous `<label>/Ignoré`. */
async function markIgnored(args: IngestArgs): Promise<void> {
  await markProcessed(
    args.accessToken,
    args.messageRef.threadId,
    args.labelName,
    args.labelId,
    args.labelCache,
    args.result,
    IGNORED_SEGMENT,
  );
}

/**
 * Sort le thread de la file : retire le label surveillé et pose
 * `<label>/Traité` (ou `<label>/Ignoré`). Une erreur ici n'est pas
 * fatale — le doublon est déjà bloqué en base — mais elle est remontée
 * pour que le label qui traîne s'explique.
 */
async function markProcessed(
  accessToken: string,
  threadId: string,
  labelName: string,
  labelId: string,
  labelCache: Map<string, string>,
  result: EmailIngestResult,
  segment: string = PROCESSED_SEGMENT,
): Promise<void> {
  try {
    const processedId = await getOrCreateGmailLabel(
      accessToken,
      `${labelName}/${segment}`,
      labelCache,
    );
    await modifyThreadLabels(accessToken, threadId, {
      addLabelIds: [processedId],
      removeLabelIds: [labelId],
    });
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Label du thread ${threadId} : ${(err as Error).message}`);
  }
}

async function uploadAudio(path: string, data: Buffer, contentType: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin credentials missing.");
  const sb = createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await sb.storage.from(AUDIO_BUCKET).upload(path, data, {
    contentType: contentType || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Upload audio : ${error.message}`);
}
