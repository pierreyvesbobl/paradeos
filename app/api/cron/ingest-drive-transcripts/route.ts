import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { ingestDriveTranscripts } from "@/lib/meetings/ingest-from-drive";
import { NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Cron 30 min : liste le dossier Drive configuré, ingère les nouveaux
 * transcripts et lance l'extraction LLM. Limite à 5 fichiers par run
 * (cf. MAX_FILES_PER_RUN) pour rester sous le timeout Vercel.
 */
export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await ingestDriveTranscripts();
    return cronResponse({ ...result, failed: result.errors, errors: result.errorDetails });
  } catch (err) {
    console.error("[cron ingest-drive-transcripts]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
