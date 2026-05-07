import { z } from "zod";

export const projectKindEnum = z.enum(["client", "product", "transverse"]);
export type ProjectKind = z.infer<typeof projectKindEnum>;

export const projectKindLabels: Record<ProjectKind, string> = {
  client: "Client",
  product: "Produit",
  transverse: "Transverse",
};

export const projectStatusEnum = z.enum([
  // Phases commerciales (kind=client)
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
  // Phases delivery
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
]);
export type ProjectStatus = z.infer<typeof projectStatusEnum>;

export const projectStatusLabels: Record<ProjectStatus, string> = {
  not_started: "Non démarré",
  to_follow_up: "À relancer",
  awaiting_response: "En attente",
  won: "Signé",
  lost: "Perdu",
  planning: "Planification",
  active: "Actif",
  on_hold: "En pause",
  completed: "Terminé",
  archived: "Archivé",
};

/** Statuts pré-delivery (commercial). `lost` est terminal. */
export const COMMERCIAL_STATUSES: ProjectStatus[] = [
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
];

export const DELIVERY_STATUSES: ProjectStatus[] = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
];

/** Probabilités par défaut pour les statuts commerciaux. */
export const projectDefaultProbability: Partial<Record<ProjectStatus, number>> = {
  not_started: 10,
  to_follow_up: 30,
  awaiting_response: 60,
  won: 100,
  lost: 0,
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

const optionalProbability = z
  .union([
    z.number().int().min(0).max(100),
    z
      .string()
      .trim()
      .transform((raw, ctx) => {
        if (!raw) return undefined;
        const num = Number.parseInt(raw, 10);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          ctx.addIssue({ code: "custom", message: "Probabilité 0-100." });
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
    contactId: optionalUuid,
    color: optionalHexColor,
    icon: optionalText(80),
    description: optionalText(5000),
    startDate: optionalDate,
    endDate: optionalDate,
    ownerId: optionalUuid,
    billingType: projectBillingTypeEnum.default("none"),
    budgetAmount: optionalAmount,
    hourlyRate: optionalAmount,
    // Champs commerciaux (kind=client, statuts pré-won).
    valueAmount: optionalAmount,
    probability: optionalProbability,
    source: optionalText(200),
    firstContactDate: optionalDate,
    lastContactDate: optionalDate,
    followUpDate: optionalDate,
    expectedCloseDate: optionalDate,
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
const nullableProbability = z.union([z.number().int().min(0).max(100), z.null()]);

export const patchProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: projectKindEnum.optional(),
  status: projectStatusEnum.optional(),
  entityId: nullableUuid.optional(),
  contactId: nullableUuid.optional(),
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
  valueAmount: nullableNumeric.optional(),
  probability: nullableProbability.optional(),
  source: nullableText(200).optional(),
  firstContactDate: nullableDate.optional(),
  lastContactDate: nullableDate.optional(),
  followUpDate: nullableDate.optional(),
  expectedCloseDate: nullableDate.optional(),
});

export const quickCreateProjectSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(200),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type QuickCreateProjectInput = z.infer<typeof quickCreateProjectSchema>;
