import "server-only";

import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { cache } from "react";

export type AppRole = "admin" | "member" | "viewer";

/**
 * Rôle applicatif d'un utilisateur (table `users`). Mis en cache React
 * par requête : le helper `action()` le lit pour chaque Server Action,
 * une page peut en enchaîner plusieurs.
 */
export const getUserRole = cache(async (userId: string): Promise<AppRole> => {
  const conn = await db();
  const [row] = await conn
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role ?? "member";
});

/** Renvoie le rôle applicatif de l'utilisateur courant. */
export async function getCurrentUserRole(user: User): Promise<AppRole> {
  return getUserRole(user.id);
}

export async function requireAdmin(user: User): Promise<void> {
  const role = await getCurrentUserRole(user);
  if (role !== "admin") {
    throw new Error("Accès réservé aux administrateurs.");
  }
}

/**
 * Refuse les `viewer` : un viewer lit tout mais ne modifie rien. C'est
 * la règle par défaut de `action()` ; les actions personnelles (profil,
 * préférences, mot de passe) passent `allowViewer: true`.
 */
export async function requireWriter(user: User): Promise<void> {
  const role = await getCurrentUserRole(user);
  if (role === "viewer") {
    throw new Error("Compte en lecture seule : modification refusée.");
  }
}
