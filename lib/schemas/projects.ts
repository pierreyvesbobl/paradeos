import { z } from "zod";

export const projectKindEnum = z.enum(["client", "product", "transverse"]);
export type ProjectKind = z.infer<typeof projectKindEnum>;

export const projectKindLabels: Record<ProjectKind, string> = {
  client: "Client",
  product: "Produit",
  transverse: "Transverse",
};

export const projectStatusEnum = z.enum(["planning", "active", "on_hold", "completed", "archived"]);
export type ProjectStatus = z.infer<typeof projectStatusEnum>;

export const projectStatusLabels: Record<ProjectStatus, string> = {
  planning: "Planification",
  active: "Actif",
  on_hold: "En pause",
  completed: "Terminé",
  archived: "Archivé",
};

export const projectBillingTypeEnum = z.enum(["none", "fixed", "hourly"]);
export type ProjectBillingType = z.infer<typeof projectBillingTypeEnum>;

export const projectBillingTypeLabels: Record<ProjectBillingType, string> = {
  none: "Non facturable",
  fixed: "Forfait",
  hourly: "Régie / TJM",
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

const optionalHexColor = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/, "Couleur hex 6 caractères.")
  .transform((v) => (v.startsWith("#") ? v : `#${v}`))
  .optional()
  .or(z.literal("").transform(() => undefined));

/** Montant €HT (positif), accepte format français ou anglais. */
const optionalAmount = z
  .union([
    z.number().nonnegative().max(99_999_999_99),
    z
      .string()
      .trim()
      .transform((raw, ctx) => {
        if (!raw) return undefined;
        const normalized = raw.replace(/\s/g, "").replace(",", ".");
        const num = Number.parseFloat(normalized);
        if (!Number.isFinite(num) || num < 0) {
          ctx.addIssue({ code: "custom", message: "Montant invalide." });
          return z.NEVER;
        }
        return num;
      }),
  ])
  .optional();

export const projectBaseSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis.").max(200),
    kind: projectKindEnum,
    status: projectStatusEnum.default("planning"),
    entityId: optionalUuid,
    color: optionalHexColor,
    icon: optionalText(80),
    description: optionalText(5000),
    startDate: optionalDate,
    endDate: optionalDate,
    ownerId: optionalUuid,
    billingType: projectBillingTypeEnum.default("none"),
    budgetAmount: optionalAmount,
    hourlyRate: optionalAmount,
  })
  .superRefine((data, ctx) => {
    if (data.kind === "client" && !data.entityId) {
      ctx.addIssue({
        code: "custom",
        path: ["entityId"],
        message: "Une entité est requise pour un projet client.",
      });
    }
    if (data.billingType === "fixed" && data.budgetAmount == null) {
      ctx.addIssue({
        code: "custom",
        path: ["budgetAmount"],
        message: "Un budget est requis pour un forfait.",
      });
    }
    if (data.billingType === "hourly" && data.hourlyRate == null) {
      ctx.addIssue({
        code: "custom",
        path: ["hourlyRate"],
        message: "Un taux horaire est requis pour la régie.",
      });
    }
  });

export const createProjectSchema = projectBaseSchema;
export const updateProjectSchema = z.intersection(
  projectBaseSchema,
  z.object({ id: z.string().uuid() }),
);
export const deleteProjectSchema = z.object({ id: z.string().uuid() });

const nullableUuid = z.union([z.string().uuid(), z.null()]);
const nullableDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  z.null(),
]);
const nullableNumeric = z.union([z.number().nonnegative().max(99_999_999_99), z.null()]);
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]);

/**
 * Patch partiel d'un projet depuis l'édition inline. Pas de validation
 * croisée (kind/entityId, billingType/budget) ici — l'inline patch un
 * champ à la fois ; les contraintes complexes restent sur les forms
 * `create/update`.
 */
export const patchProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: projectKindEnum.optional(),
  status: projectStatusEnum.optional(),
  entityId: nullableUuid.optional(),
  color: z
    .union([
      z
        .string()
        .trim()
        .regex(/^#[0-9a-fA-F]{6}$/),
      z.null(),
    ])
    .optional(),
  icon: nullableText(80).optional(),
  description: nullableText(5000).optional(),
  startDate: nullableDate.optional(),
  endDate: nullableDate.optional(),
  ownerId: nullableUuid.optional(),
  billingType: projectBillingTypeEnum.optional(),
  budgetAmount: nullableNumeric.optional(),
  hourlyRate: nullableNumeric.optional(),
});

export const quickCreateProjectSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(200),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type QuickCreateProjectInput = z.infer<typeof quickCreateProjectSchema>;
