import { z } from "zod";

export const timeEntryKindEnum = z.enum(["planned", "actual"]);
export type TimeEntryKind = z.infer<typeof timeEntryKindEnum>;

export const timeEntryKindLabels: Record<TimeEntryKind, string> = {
  planned: "Planifié",
  actual: "Réalisé",
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
  .min(1, "Requis.")
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Date / heure invalide." });

export const timeEntryBaseSchema = z
  .object({
    kind: timeEntryKindEnum.default("planned"),
    startAt: isoDateTime,
    endAt: isoDateTime,
    title: optionalText(200),
    description: optionalText(2000),
    taskId: optionalUuid,
    projectId: optionalUuid,
    contactId: optionalUuid,
    color: optionalText(20),
  })
  .superRefine((data, ctx) => {
    if (Date.parse(data.startAt) >= Date.parse(data.endAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "La fin doit être après le début.",
      });
    }
  });

export const createTimeEntrySchema = timeEntryBaseSchema;
export const updateTimeEntrySchema = z.intersection(
  timeEntryBaseSchema,
  z.object({ id: z.string().uuid() }),
);
export const deleteTimeEntrySchema = z.object({ id: z.string().uuid() });

export const moveTimeEntrySchema = z
  .object({
    id: z.string().uuid(),
    startAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Date début invalide.",
    }),
    endAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Date fin invalide.",
    }),
  })
  .superRefine((data, ctx) => {
    if (Date.parse(data.startAt) >= Date.parse(data.endAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Fin après début.",
      });
    }
  });

export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
