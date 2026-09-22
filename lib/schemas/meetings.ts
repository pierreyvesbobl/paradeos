import { z } from "zod";

/**
 * Une personne déclarée présente : membre de l'équipe, contact CRM, ou
 * nom brut. Même contrat que la contrainte SQL `meeting_participants_target_chk`.
 */
export const meetingParticipantTargetSchema = z.union([
  z.object({ userId: z.string().uuid() }),
  z.object({ contactId: z.string().uuid() }),
  z.object({ displayName: z.string().trim().min(1).max(120) }),
]);

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
  /**
   * Personnes présentes, déclarées dès la création : l'extraction est
   * lancée dans la foulée, elles doivent être en base avant.
   */
  participants: z.array(meetingParticipantTargetSchema).max(50).optional(),
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
  /** « Mauvaise fiche » : efface aussi le match automatique. */
  clearMatch: z.boolean().optional(),
});

export const updateAcceptedProposalSchema = z.object({
  proposalId: z.string().uuid(),
  payload: z.record(z.unknown()),
});

export const updateMeetingSummarySchema = z.object({
  meetingId: z.string().uuid(),
  summary: z.string().max(20_000).nullable(),
});

/**
 * Ajout d'un participant : exactement une cible parmi `userId`,
 * `contactId` et `displayName` — miroir de la contrainte SQL
 * `meeting_participants_target_chk`.
 */
export const addMeetingParticipantSchema = z
  .object({
    meetingId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    role: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine(
    (v) => [v.userId, v.contactId, v.displayName].filter(Boolean).length === 1,
    "Un participant est soit un membre de l'équipe, soit un contact, soit un nom libre.",
  );

export const removeMeetingParticipantSchema = z.object({
  meetingId: z.string().uuid(),
  participantId: z.string().uuid(),
});

export const deleteMeetingSchema = z.object({ id: z.string().uuid() });

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type ExtractMeetingInput = z.infer<typeof extractMeetingSchema>;
export type DecideProposalInput = z.infer<typeof decideProposalSchema>;
export type UpdateMeetingSubjectInput = z.infer<typeof updateMeetingSubjectSchema>;
export type AddMeetingParticipantInput = z.infer<typeof addMeetingParticipantSchema>;
