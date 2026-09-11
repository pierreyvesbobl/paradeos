"use server";

import { action } from "@/lib/actions/action";
import { getAppUrl } from "@/lib/app-url";
import {
  requestPasswordResetSchema,
  setPasswordSchema,
  signInPasswordSchema,
} from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const signInWithPassword = action(
  signInPasswordSchema,
  async ({ input }) => {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  },
  { requireAuth: false },
);

export const setPassword = action(
  setPasswordSchema,
  async ({ input }) => {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  },
  { allowViewer: true },
);

/**
 * Envoie un lien de réinitialisation par e-mail. Le lien renvoie vers
 * `/auth/confirm?type=recovery&next=/reset-password` — la route confirm
 * vérifie l'OTP et établit une session "recovery" temporaire, puis
 * redirige sur `/reset-password` où l'user choisit son nouveau mot de
 * passe (via `setPassword`).
 *
 * On retourne toujours `ok: true` même si l'e-mail n'existe pas
 * (anti-énumération).
 */
export const requestPasswordReset = action(
  requestPasswordResetSchema,
  async ({ input }) => {
    const appUrl = await getAppUrl();
    const supabase = await createClient();
    const redirectTo = `${appUrl}/auth/confirm?type=recovery&next=/reset-password`;
    await supabase.auth.resetPasswordForEmail(input.email, { redirectTo });
    return { ok: true as const };
  },
  { requireAuth: false },
);

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
