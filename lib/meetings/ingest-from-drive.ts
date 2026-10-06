import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";
import "server-only";

import { eq } from "drizzle-orm";
import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { type DriveFile, listFolderChildren } from "@/lib/google/drive-api";
import { resolveDeclaredProject, saveDeclaredParticipants } from "@/lib/meetings/declared-context";
import { findDuplicateMeeting, transcriptFingerprint } from "@/lib/meetings/dedupe";
import { parseDriveTranscriptName } from "@/lib/meetings/drive-filename";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import { getIngestionUserId } from "@/lib/meetings/ingestion-user";
import { canStartAnotherItem } from "@/lib/meetings/run-budget";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

/** Limite par run pour ne pas exploser le timeout cron Vercel. */
const MAX_FILES_PER_RUN = 5;

export type DriveIngestResult = {
  ingested: number;
  skippedExisting: number;
  /** Même transcript déjà en base sous une autre source ou une autre copie. */
  skippedDuplicate: number;
  skippedUnsupported: number;
  errors: number;
  errorDetails: string[];
};

async function downloadDriveText(file: DriveFile, accessToken: string): Promise<string | null> {
  const headers = { authorization: `Bearer ${accessToken}` };
  if (file.mimeType === GOOGLE_DOC_MIME) {
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return null;
    return res.text();
  }
  if (TEXT_MIMES.has(file.mimeType) || file.mimeType.startsWith("text/")) {
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return null;
    return res.text();
  }
  return null;
}

/**
 * Liste le dossier Drive configuré, ingère les nouveaux transcripts
 * (Google Docs / texte) et déclenche l'extraction LLM.
 *
 * Le nom du fichier n'est pas qu'un titre : Meet y écrit la date, l'heure
 * avec son fuseau, et les participants quand la réunion n'a pas de sujet
 * (« Badr Bouslikhin et Pierre-Yves Sage - 2026/07/03 10:28 CEST -
 * Transcript »). On le lit donc avant l'insert (cf. `drive-filename.ts`) :
 * la réunion arrive avec sa vraie date, ses participants rattachés et son
 * projet quand le titre en nomme un — au lieu de laisser le modèle deviner
 * tout cela à partir du seul corps du transcript.
 *
 * Trois niveaux d'idempotence :
 *   1. `source_drive_file_id` — le même fichier n'entre qu'une fois ;
 *   2. l'empreinte du contenu — une copie du fichier n'entre pas non plus,
 *      même avec un id neuf (cf. `dedupe.ts`) ;
 *   3. même créneau + même titre — attrape la copie dont le contenu a
 *      légèrement bougé.
 */
export async function ingestDriveTranscripts(): Promise<DriveIngestResult> {
  const result: DriveIngestResult = {
    ingested: 0,
    skippedExisting: 0,
    skippedDuplicate: 0,
    skippedUnsupported: 0,
    errors: 0,
    errorDetails: [],
  };

  const folderId = await getSetting(SETTING_KEYS.MEETINGS_DRIVE_FOLDER_ID);
  if (!folderId) {
    result.errorDetails.push("MEETINGS_DRIVE_FOLDER_ID non configuré.");
    return result;
  }

  const userId = await getIngestionUserId();
  if (!userId) {
    result.errorDetails.push("Aucun admin avec compte Google connecté.");
    return result;
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Token Google invalide : ${(err as Error).message}`);
    return result;
  }
  if (!accessToken) {
    result.errorDetails.push("Token Google indisponible.");
    return result;
  }

  let files: DriveFile[];
  try {
    files = await listFolderChildren(folderId, accessToken, 100);
  } catch (err) {
    result.errors++;
    result.errorDetails.push(`Listing dossier : ${(err as Error).message}`);
    return result;
  }

  const conn = await db();
  const startedAt = Date.now();
  let processed = 0;

  for (const file of files) {
    if (processed >= MAX_FILES_PER_RUN) break;
    // Mieux vaut un bilan partiel repris au run suivant qu'un 504 en
    // plein milieu d'extraction (cf. `run-budget.ts`).
    if (!canStartAnotherItem(startedAt, processed)) break;

    const isSupported =
      file.mimeType === GOOGLE_DOC_MIME ||
      TEXT_MIMES.has(file.mimeType) ||
      file.mimeType.startsWith("text/");
    if (!isSupported) {
      result.skippedUnsupported++;
      continue;
    }

    // Déjà ingéré ?
    const existing = await conn
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.sourceDriveFileId, file.id))
      .limit(1);
    if (existing.length > 0) {
      result.skippedExisting++;
      continue;
    }

    let content: string | null = null;
    try {
      content = await downloadDriveText(file, accessToken);
    } catch (err) {
      result.errors++;
      result.errorDetails.push(`Download "${file.name}" : ${(err as Error).message}`);
      continue;
    }
    if (!content || content.trim().length < 50) {
      result.skippedUnsupported++;
      continue;
    }

    const parsed = parseDriveTranscriptName(file.name);
    const modifiedAt = file.modifiedTime ? new Date(file.modifiedTime) : null;
    // Faute de date dans le nom, celle du fichier : ce n'est pas la date
    // de la réunion, mais Meet dépose le transcript dans la minute qui
    // suit, donc c'en est une bonne approximation — et surtout, c'est
    // toujours mieux que rien pour trier /meetings par date.
    const occurredAt = parsed.occurredAt ?? modifiedAt;
    const fingerprint = transcriptFingerprint(content);

    const duplicate = await findDuplicateMeeting({
      fingerprint,
      title: parsed.title,
      occurredAt,
    });
    if (duplicate) {
      result.skippedDuplicate++;
      console.info(
        `[ingest-drive] "${file.name}" doublon de la réunion ${duplicate.id} (${duplicate.reason}) — ignoré.`,
      );
      continue;
    }

    // `fuzzy: false` : un nom de fichier n'est pas une déclaration de
    // projet, seule une correspondance franche vaut un rattachement.
    const projectId = await resolveDeclaredProject(parsed.projectHint, { fuzzy: false });

    let meetingId: string | undefined;
    try {
      const [row] = await conn
        .insert(meetings)
        .values({
          title: parsed.title,
          transcript: content,
          occurredAt,
          projectId,
          sourceLabel: "Drive (auto)",
          sourceDriveFileId: file.id,
          sourceDriveFileModifiedAt: modifiedAt,
          contentFingerprint: fingerprint,
          createdBy: userId,
        })
        // Les uniques partiels (`source_drive_file_id`,
        // `content_fingerprint`) sont le dernier filet contre deux runs
        // concurrents. Rien inséré = l'autre a gagné la course.
        .onConflictDoNothing()
        .returning({ id: meetings.id });
      meetingId = row?.id;
    } catch (err) {
      result.errors++;
      result.errorDetails.push(`Insert "${file.name}" : ${(err as Error).message}`);
      continue;
    }

    if (!meetingId) {
      result.skippedDuplicate++;
      continue;
    }

    // Avant l'extraction : le prompt lit les participants déclarés et
    // résout alors les prénoms seuls du transcript au lieu de les
    // inventer (cf. `extract-and-save.ts`).
    try {
      await saveDeclaredParticipants(
        meetingId,
        parsed.participants.map((name) => ({ name, email: null })),
      );
    } catch (err) {
      // Un participant qui ne s'enregistre pas ne doit pas coûter
      // l'extraction : elle en propose de toute façon.
      result.errorDetails.push(`Participants "${file.name}" : ${(err as Error).message}`);
    }

    try {
      await extractAndSaveProposals(meetingId);
      result.ingested++;
    } catch (err) {
      result.errors++;
      result.errorDetails.push(`Extract "${file.name}" : ${(err as Error).message}`);
      // Le meeting reste avec status="ingested" sans propositions.
      // L'admin peut relancer l'extraction manuellement depuis /meetings/[id].
    }

    processed++;
  }

  return result;
}
