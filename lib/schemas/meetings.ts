import { z } from "zod";

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1, "Titre requis.").max(200),
  /**
   * Vide ou absent = la réunion est créée sans transcript (cas import
   * audio : le transcript est rempli par Whisper après l'upload).
   * Sinon, min 20 caractères pour exiger un vrai contenu.
   */
  transcript: z
    .string()
    .max(500_000)
    .refine((v) => v === "" || v.trim().length >= 20, "Transcript trop court.")
    .optional()
    .or(z.literal("").transform(() => "")),
  occurredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "Format attendu YYYY-MM-DD ou YYYY-MM-DDTHH:MM.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  sourceLabel: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  projectId: z.string().uuid().optional(),
});

export const updateMeetingSubjectSchema = z.object({
  meetingId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
});

export const extractMeetingSchema = z.object({
  meetingId: z.string().uuid(),
});

export const decideProposalSchema = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(["accept", "reject"]),
  /** Override partiel du payload, appliqué avant accept (édition humaine). */
  payloadOverride: z.record(z.unknown()).optional(),
});

export const revertProposalSchema = z.object({
  proposalId: z.string().uuid(),
});

export const updateAcceptedProposalSchema = z.object({
  proposalId: z.string().uuid(),
  payload: z.record(z.unknown()),
});

export const updateMeetingSummarySchema = z.object({
  meetingId: z.string().uuid(),
  summary: z.string().max(20_000).nullable(),
});

export const deleteMeetingSchema = z.object({ id: z.string().uuid() });

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type ExtractMeetingInput = z.infer<typeof extractMeetingSchema>;
export type DecideProposalInput = z.infer<typeof decideProposalSchema>;
export type UpdateMeetingSubjectInput = z.infer<typeof updateMeetingSubjectSchema>;
