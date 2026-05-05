"use server";

import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { getAppUrl } from "@/lib/app-url";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db/server";
import { emailLayout, sendEmail } from "@/lib/email/client";
import { deleteUserSchema, inviteUserSchema, updateUserSchema } from "@/lib/schemas/users";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Configuration Supabase admin manquante.");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Invite un nouvel utilisateur :
 *  1. crée le user dans auth.users via l'API admin (le trigger
 *     handle_new_user crée le profil dans `public.users`).
 *  2. patche le profil avec fullName/role/costRate.
 *  3. génère un magic link et l'envoie par e-mail.
 */
export const inviteUser = action(inviteUserSchema, async ({ input, user }) => {
  await requireAdmin(user);

  const admin = adminClient();
  const conn = await db();

  // 1. Créer le user (ou récupérer l'existant si l'email est déjà connu).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
  });

  let userId: string | undefined = created?.user?.id;

  if (createErr) {
    if (createErr.status === 422 || /already/i.test(createErr.message)) {
      // Email déjà inscrit : on récupère l'id pour mettre à jour le profil.
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === input.email);
      if (existing) userId = existing.id;
      else throw new Error(createErr.message);
    } else {
      throw new Error(createErr.message);
    }
  }

  if (!userId) throw new Error("Impossible de créer l'utilisateur.");

  // 2. Patche le profil applicatif.
  await conn
    .update(users)
    .set({
      fullName: input.fullName,
      role: input.role,
      costRateHourly: input.costRateHourly != null ? input.costRateHourly.toString() : null,
    })
    .where(eq(users.id, userId));

  // 3. Magic link + e-mail.
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: input.email,
  });

  const tokenHash = link?.properties?.hashed_token;
  const appUrl = await getAppUrl();
  const inviteLink = tokenHash
    ? `${appUrl}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/settings/profile`
    : null;

  if (inviteLink) {
    await sendEmail({
      to: input.email,
      subject: "Bienvenue sur Parade OS",
      html: emailLayout(`
        <p>Bonjour ${input.fullName.split(" ")[0] ?? ""},</p>
        <p>Tu as été invité·e sur <strong>Parade OS</strong>. Clique ici pour
        ouvrir ta session (lien valable 1 h) :</p>
        <p style="margin:20px 0;">
          <a href="${inviteLink}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">
            Accéder à Parade OS
          </a>
        </p>
        <p style="color:#64748b;font-size:12px;">Ensuite, depuis ton profil tu pourras
        définir un mot de passe pour les connexions suivantes.</p>
      `),
      text: `Bienvenue sur Parade OS. Active ta session : ${inviteLink}`,
      tags: [{ name: "type", value: "user-invite" }],
    });
  }

  revalidatePath("/settings/utilisateurs");
  return { id: userId, inviteLink };
});

export const updateUser = action(updateUserSchema, async ({ input, user }) => {
  await requireAdmin(user);
  const conn = await db();
  await conn
    .update(users)
    .set({
      fullName: input.fullName,
      role: input.role,
      costRateHourly: input.costRateHourly != null ? input.costRateHourly.toString() : null,
    })
    .where(eq(users.id, input.id));

  revalidatePath("/settings/utilisateurs");
  return { id: input.id };
});

export const deleteUser = action(deleteUserSchema, async ({ input, user }) => {
  await requireAdmin(user);
  if (input.id === user.id) {
    throw new Error("Tu ne peux pas supprimer ton propre compte.");
  }

  const admin = adminClient();
  const { error } = await admin.auth.admin.deleteUser(input.id);
  if (error) throw new Error(error.message);

  revalidatePath("/settings/utilisateurs");
  return { id: input.id };
});
