import { z } from "zod";

export const taskStatusEnum = z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatusEnum>;

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  blocked: "Bloquée",
  done: "Terminée",
  cancelled: "Annulée",
};

export const taskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof taskPriorityEnum>;

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: "Basse",
  medium: "Normale",
  high: "Haute",
  urgent: "Urgente",
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

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu YYYY-MM-DD.")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const taskBaseSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis.").max(300),
  description: optionalText(5000),
  status: taskStatusEnum.default("todo"),
  priority: taskPriorityEnum.default("medium"),
  projectId: optionalUuid,
  assigneeId: optionalUuid,
  dueDate: optionalDate,
  startDate: optionalDate,
});

export const createTaskSchema = taskBaseSchema;
export const updateTaskSchema = taskBaseSchema.extend({ id: z.string().uuid() });
export const deleteTaskSchema = z.object({ id: z.string().uuid() });
export const toggleTaskSchema = z.object({ id: z.string().uuid() });
export const quickCreateTaskSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis.").max(300),
  projectId: optionalUuid,
});

/**
 * Mise à jour partielle d'une tâche depuis les éditeurs inline.
 * Tous les champs sont optionnels — seuls ceux fournis sont modifiés.
 * `null` explicite = effacer (ex. retirer un assignee, un projet, une date).
 */
export const patchTaskSchema = z.object({
  id: z.string().uuid(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  projectId: z.union([z.string().uuid(), z.null()]).optional(),
  assigneeId: z.union([z.string().uuid(), z.null()]).optional(),
  dueDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."), z.null()])
    .optional(),
  startDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."), z.null()])
    .optional(),
  title: z.string().trim().min(1).max(300).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
