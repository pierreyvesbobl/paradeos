import { z } from "zod";

export const noteSubjectTypeEnum = z.enum(["entity", "contact", "opportunity", "project", "task"]);
export type NoteSubjectType = z.infer<typeof noteSubjectTypeEnum>;

export const noteSubjectTypeLabels: Record<NoteSubjectType, string> = {
  entity: "Entité",
  contact: "Contact",
  opportunity: "Opportunité",
  project: "Projet",
  task: "Tâche",
};

export const noteKindEnum = z.enum(["memo", "call", "meeting", "message"]);
export type NoteKind = z.infer<typeof noteKindEnum>;

export const noteKindLabels: Record<NoteKind, string> = {
  memo: "Mémo",
  call: "Appel",
  meeting: "Réunion",
  message: "Message",
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

const isoDateTime = z
  .string()
  .trim()
  .min(1, "Date requise.")
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Date / heure invalide." });

export const noteBaseSchema = z.object({
  title: optionalText(200),
  content: z.string().trim().min(1, "Le contenu est requis.").max(20000),
  kind: noteKindEnum.default("memo"),
  subjectType: noteSubjectTypeEnum.optional(),
  subjectId: optionalUuid,
  occurredAt: isoDateTime,
});

export const createNoteSchema = noteBaseSchema;
export const updateNoteSchema = noteBaseSchema.extend({ id: z.string().uuid() });
export const deleteNoteSchema = z.object({ id: z.string().uuid() });
export const markAllMyMentionsReadSchema = z.object({});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
