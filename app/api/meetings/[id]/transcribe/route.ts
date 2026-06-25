import { requireUser } from "@/lib/auth/server";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import { transcribeMeetingAudio } from "@/lib/meetings/transcribe";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Route synchrone qui transcrit l'audio attaché à une réunion via
 * Whisper puis chaîne l'extraction LLM. Appelée par le client après
 * upload direct browser→Storage (cf. attachAudio).
 *
 * Pourquoi une route API et pas une server action : on a besoin d'un
 * `maxDuration = 300` localisé à cette opération sans polluer le route
 * du page server component.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  void user; // auth gating uniquement
  const { id } = await params;

  try {
    const transcription = await transcribeMeetingAudio(id);
    const extraction = await extractAndSaveProposals(id);
    revalidatePath(`/meetings/${id}`);
    revalidatePath("/meetings");
    return NextResponse.json({
      ok: true,
      transcriptLength: transcription.length,
      proposalCount: extraction.count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur transcription.";
    console.error("[meetings/transcribe]", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
