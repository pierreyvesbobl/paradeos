import { z } from "zod";

export const taskStatusEnum = z.enum([
  "todo",
  "in_progress",
  "awaiting_client",
  "blocked",
  "done",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof taskStatusEnum>;

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  awaiting_client: "En attente client",
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

/**
 * Liste d'assignés (multi-assigné). Mélange membres internes (`user`) et
 * contacts externes (`contact`). Borné à 20 pour éviter une expansion
 * pathologique côté UI / DB.
 */
export const assigneesSchema = z
  .array(
    z.object({
      kind: z.enum(["user", "contact"]),
      id: z.string().uuid(),
    }),
  )
  .max(20)
  .default([]);

export type AssigneeRef = z.infer<typeof assigneesSchema>[number];

export const taskBaseSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis.").max(300),
  description: optionalText(5000),
  status: taskStatusEnum.default("todo"),
  priority: taskPriorityEnum.default("medium"),
  projectId: optionalUuid,
  /** Multi-assigné. Source de vérité depuis la phase contract. */
  assignees: assigneesSchema,
  /**
   * @deprecated Compat ascendante pour les anciens callers (form, MCP).
   * Si fourni sans `assignees`, est converti en `[{kind:"user", id}]`.
   */
  assigneeId: optionalUuid,
  /**
   * @deprecated Compat ascendante. Si fourni sans `assignees`, est
   * converti en `[{kind:"contact", id}]`.
   */
  assigneeContactId: optionalUuid,
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
  priority: taskPriorityEnum.optional(),
  /** Multi-assigné. Si absent, l'auteur est ajouté par défaut. */
  assignees: assigneesSchema.optional(),
  /** @deprecated Compat ascendante (cf. taskBaseSchema). */
  assigneeId: optionalUuid,
  /** @deprecated Compat ascendante. */
  assigneeContactId: optionalUuid,
  dueDate: optionalDate,
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
  /** Si fourni, remplace l'ensemble des assignés (strip-and-replace). */
  assignees: assigneesSchema.optional(),
  /** @deprecated Compat ascendante : `null` ou uuid mono-user. */
  assigneeId: z.union([z.string().uuid(), z.null()]).optional(),
  /** @deprecated Compat ascendante : `null` ou uuid mono-contact. */
  assigneeContactId: z.union([z.string().uuid(), z.null()]).optional(),
  dueDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."), z.null()])
    .optional(),
  startDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."), z.null()])
    .optional(),
  title: z.string().trim().min(1).max(300).optional(),
});

/**
 * Mise à jour en masse depuis la barre d'actions flottante (sélection
 * multiple). `ids` borné à 500 pour éviter qu'un UPDATE ... WHERE id =
 * ANY(...) ne touche tout par accident. `patch` reprend la même surface
 * que `patchTaskSchema` (un sous-ensemble de champs).
 */
export const bulkPatchTaskSchema = z.object({
  ids: z.string().uuid().array().min(1).max(500),
  patch: z.object({
    status: taskStatusEnum.optional(),
    priority: taskPriorityEnum.optional(),
    /** Si fourni, remplace les assignés sur **toutes** les tâches ciblées. */
    assignees: assigneesSchema.optional(),
    /** @deprecated Compat ascendante. */
    assigneeId: z.union([z.string().uuid(), z.null()]).optional(),
    /** @deprecated Compat ascendante. */
    assigneeContactId: z.union([z.string().uuid(), z.null()]).optional(),
    dueDate: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."), z.null()])
      .optional(),
  }),
});

export const bulkDeleteTaskSchema = z.object({
  ids: z.string().uuid().array().min(1).max(500),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type BulkPatchTaskInput = z.infer<typeof bulkPatchTaskSchema>;
