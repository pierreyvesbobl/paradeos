import "server-only";

import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

/**
 * Renvoie le rôle applicatif de l'utilisateur courant (table `users`).
 * Lance si le profil n'existe pas (cas anormal — trigger handle_new_user).
 */
export async function getCurrentUserRole(user: User): Promise<"admin" | "member" | "viewer"> {
  const conn = await db();
  const [row] = await conn
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  return row?.role ?? "member";
}

export async function requireAdmin(user: User): Promise<void> {
  const role = await getCurrentUserRole(user);
  if (role !== "admin") {
    throw new Error("Accès réservé aux administrateurs.");
  }
}
