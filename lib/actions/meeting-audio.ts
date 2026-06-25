"use server";

import { meetings } from "@/db/schema/meetings";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  attachAudioSchema,
  deleteAudioSchema,
  signedAudioUrlSchema,
} from "@/lib/schemas/meeting-audio";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const BUCKET = "meeting-audio";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin credentials missing.");
  }
  return createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Mint une URL signée pour upload direct browser → Storage (PUT).
 * Pattern miroir de `lib/actions/note-attachments.ts:signedUploadUrl`.
 */
export const signedAudioUploadUrl = action(signedAudioUrlSchema, async ({ input }) => {
  const sb = admin();
  const path = `${input.meetingId}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Création URL upload : ${error.message}`);
  if (!data) throw new Error("URL upload non retournée.");

  return {
    path,
    signedUrl: data.signedUrl,
    token: data.token,
  };
});

/**
 * Persiste les métadonnées audio sur la row meeting après upload côté
 * client. Remplace l'audio précédent s'il existait (un seul audio par
 * réunion en MVP). Repasse `transcription_status` à `idle` pour signaler
 * au pipeline qu'il y a un nouveau fichier à traiter.
 */
export const attachAudio = action(attachAudioSchema, async ({ input }) => {
  const conn = await db();

  const [meeting] = await conn
    .select({ id: meetings.id, prevPath: meetings.audioStoragePath })
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  // Si un audio précédent existait, on supprime le fichier en Storage
  // pour ne pas laisser d'orphelins. La row meeting elle-même est juste
  // mise à jour (pas supprimée).
  if (meeting.prevPath && meeting.prevPath !== input.storagePath) {
    const sb = admin();
    const { error } = await sb.storage.from(BUCKET).remove([meeting.prevPath]);
    if (error) console.error("[meeting-audio] cleanup prev audio:", error);
  }

  await conn
    .update(meetings)
    .set({
      audioStoragePath: input.storagePath,
      audioFileName: input.fileName,
      audioMimeType: input.mimeType ?? null,
      audioSizeBytes: input.sizeBytes ?? null,
      transcriptionStatus: "idle",
      transcriptionError: null,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));

  revalidatePath(`/meetings/${input.meetingId}`);
  return { ok: true as const };
});

/** Supprime l'audio (Storage + colonnes meeting). Le transcript déjà
 * généré, lui, reste — l'utilisateur a probablement validé des
 * propositions dessus. */
export const deleteAudio = action(deleteAudioSchema, async ({ input }) => {
  const conn = await db();

  const [meeting] = await conn
    .select({ path: meetings.audioStoragePath })
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  if (meeting.path) {
    const sb = admin();
    const { error } = await sb.storage.from(BUCKET).remove([meeting.path]);
    if (error) console.error("[meeting-audio] storage remove error:", error);
  }

  await conn
    .update(meetings)
    .set({
      audioStoragePath: null,
      audioFileName: null,
      audioMimeType: null,
      audioSizeBytes: null,
      transcriptionStatus: "idle",
      transcriptionError: null,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));

  revalidatePath(`/meetings/${input.meetingId}`);
  return { ok: true as const };
});

function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 200);
}
