import { z } from "zod";

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("E-mail invalide.")
  .max(200)
  .optional()
  .or(z.literal("").transform(() => undefined));

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

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

export const contactBaseSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est requis.").max(120),
  lastName: z.string().trim().min(1, "Le nom est requis.").max(120),
  email: optionalEmail,
  phone: optionalText(40),
  jobTitle: optionalText(160),
  linkedinUrl: optionalUrl,
  entityId: optionalUuid,
  ownerId: optionalUuid,
  notes: optionalText(5000),
});

export const createContactSchema = contactBaseSchema;

export const updateContactSchema = contactBaseSchema.extend({
  id: z.string().uuid(),
});

export const deleteContactSchema = z.object({ id: z.string().uuid() });

const nullableUuid = z.union([z.string().uuid(), z.null()]);
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]);
const nullableEmail = z.union([
  z.string().trim().toLowerCase().email("E-mail invalide.").max(200),
  z.null(),
]);
const nullableUrl = z.union([z.string().trim().url("URL invalide.").max(500), z.null()]);

/**
 * Patch partiel d'un contact (édition inline). Pas de cohérence multi-champ.
 */
export const patchContactSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  email: nullableEmail.optional(),
  phone: nullableText(40).optional(),
  jobTitle: nullableText(160).optional(),
  linkedinUrl: nullableUrl.optional(),
  entityId: nullableUuid.optional(),
  ownerId: nullableUuid.optional(),
  notes: nullableText(5000).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type PatchContactInput = z.infer<typeof patchContactSchema>;
