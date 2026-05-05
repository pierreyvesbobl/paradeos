import { z } from "zod";

export const opportunityStatusEnum = z.enum([
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
]);
export type OpportunityStatus = z.infer<typeof opportunityStatusEnum>;

export const opportunityStatusLabels: Record<OpportunityStatus, string> = {
  not_started: "Non démarrée",
  to_follow_up: "À relancer",
  awaiting_response: "En attente de réponse",
  won: "Signée",
  lost: "Abandonnée",
};

/** Probabilités par défaut suggérées selon le statut. */
export const opportunityDefaultProbability: Record<OpportunityStatus, number> = {
  not_started: 10,
  to_follow_up: 40,
  awaiting_response: 60,
  won: 100,
  lost: 0,
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

/** Montant en euros HT, accepte format français "1 234,56" ou anglais. */
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
          ctx.addIssue({ code: "custom", message: "Entier entre 0 et 100." });
          return z.NEVER;
        }
        return num;
      }),
  ])
  .optional();

export const opportunityBaseSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis.").max(200),
  status: opportunityStatusEnum.default("not_started"),
  entityId: optionalUuid,
  contactId: optionalUuid,
  valueAmount: optionalAmount,
  probability: optionalProbability,
  source: optionalText(120),
  firstContactDate: optionalDate,
  lastContactDate: optionalDate,
  followUpDate: optionalDate,
  expectedCloseDate: optionalDate,
  ownerId: optionalUuid,
  notes: optionalText(5000),
});

export const createOpportunitySchema = opportunityBaseSchema;
export const updateOpportunitySchema = opportunityBaseSchema.extend({
  id: z.string().uuid(),
});
export const deleteOpportunitySchema = z.object({ id: z.string().uuid() });

const nullableUuid = z.union([z.string().uuid(), z.null()]);
const nullableDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD."),
  z.null(),
]);
const nullableInt0to100 = z.union([z.number().int().min(0).max(100), z.null()]);
const nullableNumeric = z.union([z.number().nonnegative().max(99_999_999_99), z.null()]);
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]);

/**
 * Patch partiel d'une opportunité — un seul champ à la fois en général.
 * Les FK / dates / numériques acceptent `null` explicite pour effacer.
 */
export const patchOpportunitySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  status: opportunityStatusEnum.optional(),
  entityId: nullableUuid.optional(),
  contactId: nullableUuid.optional(),
  valueAmount: nullableNumeric.optional(),
  probability: nullableInt0to100.optional(),
  source: nullableText(120).optional(),
  firstContactDate: nullableDate.optional(),
  lastContactDate: nullableDate.optional(),
  followUpDate: nullableDate.optional(),
  expectedCloseDate: nullableDate.optional(),
  ownerId: nullableUuid.optional(),
  notes: nullableText(5000).optional(),
});
export const convertOpportunitySchema = z.object({
  id: z.string().uuid(),
  projectName: z.string().trim().min(1).max(200).optional(),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
