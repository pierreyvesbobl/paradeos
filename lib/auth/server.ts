import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cache } from "react";

/**
 * Wrappé dans React `cache()` pour dédupliquer les appels dans un même
 * render request. `supabase.auth.getUser()` fait une requête réseau au
 * service auth Supabase ; sans cache, chaque Server Component qui appelait
 * `requireUser()` (layout + page + sous-composants) déclenchait un fetch
 * séparé (~100-300 ms par appel × 5-10 appels = jusqu'à 3 s perdus).
 *
 * `cache()` n'agit que pendant un seul render ; entre requêtes, la fonction
 * est ré-exécutée comme attendu.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Garde-fou serveur : à utiliser dans les pages, layouts et server actions
 * qui exigent un utilisateur authentifié. Le middleware redirige déjà,
 * mais cet appel sécurise le code en aval (typage non-null + redirect
 * de secours si le middleware est court-circuité).
 */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
