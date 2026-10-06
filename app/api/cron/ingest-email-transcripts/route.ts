import { NextResponse } from "next/server";
import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { ingestEmailTranscripts } from "@/lib/meetings/ingest-from-email";

export const maxDuration = 300;

/**
 * Cron 30 min : lit les mails portant le label Gmail configuré, crée
 * une réunion par message (PJ texte / PDF / audio, ou corps du mail),
 * transcrit l'audio via Whisper puis lance l'extraction LLM. Limite à
 * 3 messages par run (cf. MAX_MESSAGES_PER_RUN) pour rester sous le
 * timeout Vercel.
 */
export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await ingestEmailTranscripts();
    return cronResponse({ ...result, failed: result.errors, errors: result.errorDetails });
  } catch (err) {
    console.error("[cron ingest-email-transcripts]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
