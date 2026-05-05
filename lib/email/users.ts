import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Récupère les emails depuis auth.users via l'API admin Supabase.
 * Retourne un map userId → email (uniquement les users trouvés).
 *
 * Usage côté Server Actions : la clé service_role n'est jamais exposée
 * au client.
 */
export async function getUserEmails(userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("[email:users] Supabase admin credentials manquants.");
    return {};
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const out: Record<string, string> = {};
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (!error && data.user?.email) {
          out[id] = data.user.email;
        }
      } catch (err) {
        console.error("[email:users] getUserById error:", id, err);
      }
    }),
  );
  return out;
}
