import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

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
