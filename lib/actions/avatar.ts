"use server";

import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin credentials missing.");
  return createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function publicUrl(path: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL manquant.");
  return `${url}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Upload une image de profil et met à jour `users.avatar_url`.
 *
 * Stratégie : path préfixé par userId pour éviter les collisions et
 * permettre un retrieve déterministe. Ajout d'un timestamp comme suffixe
 * pour casser le cache côté navigateur sans avoir à invalider le CDN.
 */
export async function uploadAvatar(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const user = await requireUser();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Aucun fichier reçu." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "Image trop lourde (max 5 MB)." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, message: "Format non supporté (PNG/JPEG/WebP/GIF)." };
  }

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
  const path = `${user.id}/${Date.now()}.${ext}`;

  const sb = admin();
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, arrayBuffer, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    return { ok: false, message: `Upload échoué : ${uploadError.message}` };
  }

  const url = publicUrl(path);

  // Récupère l'ancien path pour le supprimer après le swap (cleanup).
  const conn = await db();
  const [previous] = await conn
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  await conn.update(users).set({ avatarUrl: url }).where(eq(users.id, user.id));

  // Cleanup ancien fichier (best-effort, ne bloque pas).
  if (previous?.avatarUrl?.includes(`/storage/v1/object/public/${BUCKET}/`)) {
    const oldPath = previous.avatarUrl.split(`/${BUCKET}/`)[1];
    if (oldPath?.startsWith(`${user.id}/`)) {
      await sb.storage.from(BUCKET).remove([oldPath]);
    }
  }

  revalidatePath("/settings/profile");
  revalidatePath("/");
  return { ok: true, url };
}

export async function removeAvatar(): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await requireUser();
  const conn = await db();

  const [previous] = await conn
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (previous?.avatarUrl?.includes(`/storage/v1/object/public/${BUCKET}/`)) {
    const oldPath = previous.avatarUrl.split(`/${BUCKET}/`)[1];
    if (oldPath?.startsWith(`${user.id}/`)) {
      const sb = admin();
      await sb.storage.from(BUCKET).remove([oldPath]);
    }
  }

  await conn.update(users).set({ avatarUrl: null }).where(eq(users.id, user.id));

  revalidatePath("/settings/profile");
  revalidatePath("/");
  return { ok: true };
}
