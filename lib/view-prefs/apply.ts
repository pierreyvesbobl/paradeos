import "server-only";

import { requireUser } from "@/lib/auth/server";
import { getViewPref } from "@/lib/db/queries/view-prefs";
import { redirect } from "next/navigation";

/**
 * À appeler en haut d'un Server Component de page liste, AVANT toute
 * autre lecture des `searchParams`. Si l'URL n'a aucun paramètre persistable
 * et que l'utilisateur a une préférence stockée non vide, redirige vers
 * `pathname?<saved>` pour que le rendu se fasse directement avec les
 * filtres mémorisés (zéro flash).
 *
 * `searchParams` doit être l'objet déjà awaité (Next 15 : Promise<...>).
 * Les clés UI temporaires (modals, dialog, etc.) sont ignorées via
 * `relevantKeys`.
 */
export async function applyViewPrefRedirect({
  pageKey,
  pathname,
  searchParams,
  relevantKeys,
}: {
  pageKey: string;
  pathname: string;
  searchParams: Record<string, string | string[] | undefined>;
  relevantKeys: readonly string[];
}): Promise<void> {
  // Si l'URL contient déjà un param pertinent, on respecte le choix
  // explicite (lien partagé, navigation manuelle).
  const hasRelevant = relevantKeys.some((k) => {
    const v = searchParams[k];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === "string" && v.length > 0;
  });
  if (hasRelevant) return;

  const user = await requireUser();
  const saved = await getViewPref(user.id, pageKey);
  if (!saved || saved.length === 0) return;

  redirect(`${pathname}?${saved}`);
}
