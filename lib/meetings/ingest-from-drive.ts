import "server-only";

import { googleAccounts } from "@/db/schema/google-accounts";
import { meetings } from "@/db/schema/meetings";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { type DriveFile, listFolderChildren } from "@/lib/google/drive-api";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { eq } from "drizzle-orm";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

/** Limite par run pour ne pas exploser le timeout cron Vercel. */
const MAX_FILES_PER_RUN = 5;

export type DriveIngestResult = {
  ingested: number;
  skippedExisting: number;
  skippedUnsupported: number;
  errors: number;
  errorDetails: string[];
};

/**
 * Cherche un user admin avec un compte Google connecté pour exécuter
 * la sync sous son identité. La cron n'a pas de contexte user — on
 * impersonate un admin.
 */
async function getIngestionUserId(): Promise<string | null> {
  const conn = await db();
  const [row] = await conn
    .select({ id: users.id })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.role, "admin"))
    .limit(1);
  return row?.id ?? null;
}

async function downloadDriveText(file: DriveFile, accessToken: string): Promise<string | null> {
  const headers = { authorization: `Bearer ${accessToken}` };
  if (file.mimeType === GOOGLE_DOC_MIME) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return null;
    return res.text();
  }
  if (TEXT_MIMES.has(file.mimeType) || file.mimeType.startsWith("text/")) {
    const res = await fetch(
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
 * (Google Docs / texte) et déclenche l'extraction LLM. Idempotent :
 * un fichier déjà ingéré (matché par `source_drive_file_id`) est
 * sauté.
 */
export async function ingestDriveTranscripts(): Promise<DriveIngestResult> {
  const result: DriveIngestResult = {
    ingested: 0,
    skippedExisting: 0,
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
  let processed = 0;

  for (const file of files) {
    if (processed >= MAX_FILES_PER_RUN) break;

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

    const modifiedAt = file.modifiedTime ? new Date(file.modifiedTime) : null;

    let meetingId: string | undefined;
    try {
      const [row] = await conn
        .insert(meetings)
        .values({
          title: file.name,
          transcript: content,
          sourceLabel: "Drive (auto)",
          sourceDriveFileId: file.id,
          sourceDriveFileModifiedAt: modifiedAt,
          createdBy: userId,
        })
        .returning({ id: meetings.id });
      meetingId = row?.id;
    } catch (err) {
      // ON CONFLICT silencieux n'est pas posé sur l'insert ; le partial
      // unique index empêche le doublon. Si la query lève, on log.
      result.errors++;
      result.errorDetails.push(`Insert "${file.name}" : ${(err as Error).message}`);
      continue;
    }

    if (!meetingId) {
      result.errors++;
      continue;
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
