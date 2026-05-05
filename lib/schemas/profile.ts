import { z } from "zod";

const optionalCostRate = z
  .union([
    z.number().nonnegative().max(99999),
    z
      .string()
      .trim()
      .transform((raw, ctx) => {
        if (!raw) return undefined;
        const normalized = raw.replace(/\s/g, "").replace(",", ".");
        const num = Number.parseFloat(normalized);
        if (!Number.isFinite(num) || num < 0) {
          ctx.addIssue({ code: "custom", message: "Taux invalide." });
          return z.NEVER;
        }
        return num;
      }),
  ])
  .optional();

export const updateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Le nom doit faire au moins 2 caractères.")
    .max(120, "Le nom est trop long."),
  /** €HT/h. Utilisé pour calculer la rentabilité. */
  costRateHourly: optionalCostRate,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
