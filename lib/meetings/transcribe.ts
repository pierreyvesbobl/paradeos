import "server-only";

import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { experimental_transcribe as transcribe } from "ai";
import { eq } from "drizzle-orm";

const BUCKET = "meeting-audio";
const MODEL_ID = "whisper-1";
const PROVIDER_LABEL = "openai-whisper-1";

/**
 * Transcrit l'audio attaché à une réunion via OpenAI Whisper et remplit
 * la colonne `transcript`. Met à jour `transcription_status` au fil de
 * l'exécution. Retourne le nombre de caractères transcrits.
 *
 * - Utilise une clé OpenAI **directe** stockée dans `app_settings`
 *   (SETTING_KEYS.OPENAI_API_KEY), différente de la clé OpenRouter qui
 *   sert au LLM d'extraction (OpenRouter ne supporte pas l'audio).
 * - Pas d'extraction des propositions ici : le caller chaîne avec
 *   `extractAndSaveProposals(meetingId)` pour découpler les deux phases.
 */
export async function transcribeMeetingAudio(meetingId: string): Promise<{ length: number }> {
  const conn = await db();
  const [meeting] = await conn
    .select({
      id: meetings.id,
      path: meetings.audioStoragePath,
      mime: meetings.audioMimeType,
      fileName: meetings.audioFileName,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");
  if (!meeting.path) throw new Error("Aucun audio attaché à cette réunion.");

  const apiKey = await getSetting(SETTING_KEYS.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error(
      "Clé OpenAI manquante : configure-la dans Réglages → Intégrations (section transcription).",
    );
  }

  await conn
    .update(meetings)
    .set({
      transcriptionStatus: "running",
      transcriptionError: null,
      transcriptionProvider: PROVIDER_LABEL,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId));

  try {
    const audio = await downloadAudio(meeting.path);
    const openai = createOpenAI({ apiKey });
    const result = await transcribe({
      model: openai.transcription(MODEL_ID),
      audio,
    });
    const transcript = result.text ?? "";

    await conn
      .update(meetings)
      .set({
        transcript,
        transcriptionStatus: "done",
        transcriptionError: null,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meetingId));

    return { length: transcript.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur transcription.";
    await conn
      .update(meetings)
      .set({
        transcriptionStatus: "error",
        transcriptionError: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meetingId));
    throw err;
  }
}

async function downloadAudio(path: string): Promise<Uint8Array> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin credentials missing.");
  const sb = createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Téléchargement audio échoué.");
  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}
