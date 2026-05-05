import { z } from "zod";

export const signedUrlSchema = z.object({
  noteId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
});

export const attachToNoteSchema = z.object({
  noteId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .max(50 * 1024 * 1024)
    .optional(),
});

export const deleteAttachmentSchema = z.object({
  id: z.string().uuid(),
});

export const getDownloadUrlSchema = z.object({
  storagePath: z.string().min(1).max(500),
});
