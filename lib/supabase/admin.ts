import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase « service_role » : bypass la RLS, donne accès à l'API admin
 * (`auth.users`) et au Storage sans session utilisateur. C'est le seul
 * endroit du code qui lit `SUPABASE_SERVICE_ROLE_KEY` — pour auditer qui
 * s'en sert, chercher `createAdminClient` suffit.
 *
 * `server-only` : jamais importé depuis un composant client.
 */
export function createAdminClient(): SupabaseClient {
  const client = tryCreateAdminClient();
  if (!client) {
    throw new Error(
      "Configuration Supabase admin manquante (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return client;
}

/**
 * Variante qui renvoie `null` quand la configuration manque, pour les
 * chemins qui préfèrent dégrader que planter (purge au mieux, enrichissement
 * d'un mail).
 */
export function tryCreateAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
