import { z } from "zod";

export const signInPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  password: z.string().min(1, "Mot de passe requis."),
});

export const signUpPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  password: z.string().min(8, "8 caractères minimum.").max(72, "72 caractères maximum."),
});

export const setPasswordSchema = z.object({
  password: z.string().min(8, "8 caractères minimum.").max(72, "72 caractères maximum."),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
});

export type SignInPasswordInput = z.infer<typeof signInPasswordSchema>;
export type SignUpPasswordInput = z.infer<typeof signUpPasswordSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
