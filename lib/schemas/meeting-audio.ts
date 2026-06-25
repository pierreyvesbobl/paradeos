import { z } from "zod";

/**
 * 25 Mo — limite native d'OpenAI Whisper. Au-delà : refusé côté client
 * et côté serveur. Couvre ~45 min en m4a 64 kbps.
 */
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;

export const signedAudioUrlSchema = z.object({
  meetingId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
});

export const attachAudioSchema = z.object({
  meetingId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().min(0).max(AUDIO_MAX_BYTES).optional(),
});

export const deleteAudioSchema = z.object({
  meetingId: z.string().uuid(),
});
