import "server-only";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * Récupère les emails depuis auth.users via l'API admin Supabase.
 * Retourne un map userId → email (uniquement les users trouvés).
 *
 * Usage côté Server Actions : la clé service_role n'est jamais exposée
 * au client.
 */
export async function getUserEmails(userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};

  const admin = tryCreateAdminClient();
  if (!admin) {
    console.warn("[email:users] Supabase admin credentials manquants.");
    return {};
  }

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
