import { z } from "zod";

export const userRoleEnum = z.enum(["admin", "member", "viewer"]);
export type UserRoleValue = z.infer<typeof userRoleEnum>;

export const userRoleLabels: Record<UserRoleValue, string> = {
  admin: "Admin",
  member: "Membre",
  viewer: "Lecture",
};

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

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide.").max(254),
  fullName: z.string().trim().min(2, "Nom trop court.").max(120),
  role: userRoleEnum.default("member"),
  costRateHourly: optionalCostRate,
});

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120),
  role: userRoleEnum,
  costRateHourly: optionalCostRate,
});

export const deleteUserSchema = z.object({ id: z.string().uuid() });

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
