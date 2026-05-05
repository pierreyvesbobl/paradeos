"use server";

import { action } from "@/lib/actions/action";
import { setPasswordSchema, signInPasswordSchema, signUpPasswordSchema } from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
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

/**
 * Crée un compte email + mot de passe et ouvre la session immédiatement.
 *
 * On passe par l'admin API (`createUser` avec `email_confirm: true`) pour
 * éviter l'étape de confirmation par e-mail — l'utilisateur peut se
 * connecter directement après inscription.
 */
export const signUpWithPassword = action(
  signUpPasswordSchema,
  async ({ input }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Configuration Supabase manquante.");
    }

    const admin = createServiceClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: createErr } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (createErr) {
      if (createErr.status === 422 || /already|registered/i.test(createErr.message)) {
        throw new Error("Un compte existe déjà pour cet e-mail.");
      }
      throw new Error(createErr.message);
    }

    const supabase = await createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (signInErr) throw new Error(signInErr.message);

    return { ok: true as const };
  },
  { requireAuth: false },
);

export const setPassword = action(setPasswordSchema, async ({ input }) => {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) throw new Error(error.message);
  return { ok: true as const };
});

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
