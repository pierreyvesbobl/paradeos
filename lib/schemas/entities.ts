import { z } from "zod";

export const entityKindEnum = z.enum(["client", "prospect", "partner", "supplier", "other"]);
export type EntityKind = z.infer<typeof entityKindEnum>;

export const entityKindLabels: Record<EntityKind, string> = {
  client: "Client",
  prospect: "Prospect",
  partner: "Partenaire",
  supplier: "Fournisseur",
  other: "Autre",
};

const optionalUrl = z
  .string()
  .trim()
  .url("URL invalide.")
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));

const sirenSchema = z
  .string()
  .trim()
  .regex(/^\d{9}$/, "Le SIREN doit contenir 9 chiffres.")
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * SIRET : 14 chiffres (SIREN + NIC). C'est l'identifiant d'établissement
 * attendu par l'annuaire de la facturation électronique — le SIREN seul ne
 * permet pas de router vers le bon établissement destinataire.
 */
const siretSchema = z
  .string()
  .trim()
  .regex(/^\d{14}$/, "Le SIRET doit contenir 14 chiffres.")
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * TVA intracommunautaire. Le format français (FR + 11 caractères) est
 * vérifié, les autres pays sont acceptés tels quels : on ne va pas encoder
 * les 27 formats nationaux pour un champ de saisie.
 */
const vatNumberSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => !/^FR/i.test(v) || /^FR[0-9A-Z]{11}$/i.test(v), {
    message: "Un numéro de TVA français s'écrit FR suivi de 11 caractères.",
  })
  .optional()
  .or(z.literal("").transform(() => undefined));

export const addressSchema = z
  .object({
    street: optionalText(200),
    postalCode: optionalText(20),
    city: optionalText(120),
    country: optionalText(80),
  })
  .strict();

export const entityBaseSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(200),
  kind: entityKindEnum.default("prospect"),
  website: optionalUrl,
  siren: sirenSchema,
  siret: siretSchema,
  legalName: optionalText(200),
  vatNumber: vatNumberSchema,
  address: addressSchema.optional(),
  deliveryAddress: addressSchema.optional(),
  notes: optionalText(5000),
  ownerId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const createEntitySchema = entityBaseSchema;

export const updateEntitySchema = entityBaseSchema.extend({
  id: z.string().uuid(),
});

export const deleteEntitySchema = z.object({ id: z.string().uuid() });

const nullableUuid = z.union([z.string().uuid(), z.null()]);
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]);
const nullableUrl = z.union([z.string().trim().url("URL invalide.").max(500), z.null()]);
const nullableSiren = z.union([
  z
    .string()
    .trim()
    .regex(/^\d{9}$/, "Le SIREN doit contenir 9 chiffres."),
  z.null(),
]);
const nullableSiret = z.union([
  z
    .string()
    .trim()
    .regex(/^\d{14}$/, "Le SIRET doit contenir 14 chiffres."),
  z.null(),
]);
const nullableVatNumber = z.union([
  z
    .string()
    .trim()
    .max(40)
    .refine((v) => !/^FR/i.test(v) || /^FR[0-9A-Z]{11}$/i.test(v), {
      message: "Un numéro de TVA français s'écrit FR suivi de 11 caractères.",
    }),
  z.null(),
]);
const nullableAddress = z.union([
  z
    .object({
      street: z.string().max(200).nullable().optional(),
      postalCode: z.string().max(20).nullable().optional(),
      city: z.string().max(120).nullable().optional(),
      country: z.string().max(80).nullable().optional(),
    })
    .strict(),
  z.null(),
]);

/** Patch partiel d'une entité (édition inline). */
export const patchEntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: entityKindEnum.optional(),
  website: nullableUrl.optional(),
  siren: nullableSiren.optional(),
  siret: nullableSiret.optional(),
  legalName: nullableText(200).optional(),
  vatNumber: nullableVatNumber.optional(),
  address: nullableAddress.optional(),
  deliveryAddress: nullableAddress.optional(),
  notes: nullableText(5000).optional(),
  ownerId: nullableUuid.optional(),
});

export const quickCreateEntitySchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(200),
});

export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
export type PatchEntityInput = z.infer<typeof patchEntitySchema>;
export type QuickCreateEntityInput = z.infer<typeof quickCreateEntitySchema>;
