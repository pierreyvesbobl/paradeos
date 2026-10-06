import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Utilisateur authentifié tel que l'application le voit : les claims du
 * JWT, pas l'objet `User` complet de Supabase. Le code n'a besoin que de
 * l'id, de l'email et des métadonnées (avatar) — c'est volontairement tout.
 */
export type AuthUser = {
  id: string;
  email?: string;
  user_metadata: Record<string, unknown>;
};

/**
 * Wrappé dans React `cache()` pour dédupliquer les appels dans un même
 * render request (layout + page + sous-composants).
 *
 * `getClaims()` vérifie le JWT localement contre les clés publiques du
 * projet (JWKS, gardées en mémoire) : pas d'aller-retour vers le service
 * auth à chaque requête, contrairement à `getUser()` qui en faisait un
 * systématiquement (~100-300 ms, et une seconde fois dans le middleware).
 * Contrepartie assumée : une session révoquée côté Supabase reste acceptée
 * jusqu'à l'expiration de l'access token (1 h).
 *
 * `cache()` n'agit que pendant un seul render ; entre requêtes, la fonction
 * est ré-exécutée comme attendu.
 */
export const getUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const { claims } = data;
  return {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata ?? {},
  };
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
