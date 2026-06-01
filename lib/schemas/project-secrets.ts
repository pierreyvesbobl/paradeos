import { z } from "zod";

const labelField = z.string().trim().min(1).max(120);
const valueField = z.string().min(1).max(10_000);
const optionalEncField = z
  .string()
  .max(10_000)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));
const urlField = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const createProjectSecretSchema = z.object({
  projectId: z.string().uuid(),
  label: labelField,
  url: urlField,
  username: optionalEncField,
  value: valueField,
  notes: optionalEncField,
});

/**
 * Pour l'update on accepte `value` vide (= "ne pas changer"). Idem
 * `username`/`notes` : `undefined` = inchangé, chaîne vide = effacer.
 */
export const updateProjectSecretSchema = z.object({
  id: z.string().uuid(),
  label: labelField,
  url: urlField,
  username: z.string().max(10_000).optional(),
  value: z.string().max(10_000).optional(),
  notes: z.string().max(10_000).optional(),
});

export const deleteProjectSecretSchema = z.object({
  id: z.string().uuid(),
});

export const revealProjectSecretSchema = z.object({
  id: z.string().uuid(),
});

export type CreateProjectSecretInput = z.infer<typeof createProjectSecretSchema>;
export type UpdateProjectSecretInput = z.infer<typeof updateProjectSecretSchema>;
