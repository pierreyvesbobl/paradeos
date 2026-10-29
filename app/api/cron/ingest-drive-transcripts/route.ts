import { NextResponse } from "next/server";
import { cronResponse, cronRun, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import { ingestDriveTranscripts } from "@/lib/meetings/ingest-from-drive";
import { backfillMeetingProjects } from "@/lib/meetings/project-attach";

export const maxDuration = 300;

/**
 * Cron 30 min : liste le dossier Drive configuré, ingère les nouveaux
 * transcripts et lance l'extraction LLM. Limite à 5 fichiers par run
 * (cf. MAX_FILES_PER_RUN) pour rester sous le timeout Vercel. Rattache
 * ensuite à leur projet les réunions sans projet dont les indices
 * concordent (cf. lib/meetings/project-attach.ts).
 */
async function run(request: Request): Promise<Response> {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await ingestDriveTranscripts();
    // Réunions restées sans projet : rattachées si les indices concordent.
    // Des requêtes seulement, pas de LLM ; un échec ne compte pas pour la relève.
    let projectsAttached: { checked: number; attached: number } | { error: string };
    try {
      projectsAttached = await backfillMeetingProjects(await db());
    } catch (err) {
      projectsAttached = { error: err instanceof Error ? err.message : String(err) };
    }
    return cronResponse({
      ...result,
      projectsAttached,
      failed: result.errors,
      errors: result.errorDetails,
    });
  } catch (err) {
    console.error("[cron ingest-drive-transcripts]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

/** `?detach=1` : répond tout de suite, le travail continue (cf. `cronRun`). */
export function GET(request: Request) {
  return cronRun(request, () => run(request));
}
