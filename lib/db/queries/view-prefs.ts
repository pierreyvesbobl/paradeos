import "server-only";

import { userViewPrefs } from "@/db/schema/user-view-prefs";
import { db } from "@/lib/db/server";
import { and, eq } from "drizzle-orm";

/**
 * Récupère la querystring mémorisée pour `(userId, pageKey)`. Renvoie `null`
 * si rien n'est stocké, ou une chaîne (potentiellement vide).
 */
export async function getViewPref(userId: string, pageKey: string): Promise<string | null> {
  const conn = await db();
  const [row] = await conn
    .select({ params: userViewPrefs.params })
    .from(userViewPrefs)
    .where(and(eq(userViewPrefs.userId, userId), eq(userViewPrefs.pageKey, pageKey)))
    .limit(1);
  return row?.params ?? null;
}

/**
 * Upsert de la préférence. Une chaîne vide est stockée telle quelle —
 * elle exprime explicitement « pas de filtre » et bloque le chargement
 * d'une ancienne préférence après un Reset.
 */
export async function setViewPref(userId: string, pageKey: string, params: string): Promise<void> {
  const conn = await db();
  await conn
    .insert(userViewPrefs)
    .values({ userId, pageKey, params })
    .onConflictDoUpdate({
      target: [userViewPrefs.userId, userViewPrefs.pageKey],
      set: { params, updatedAt: new Date() },
    });
}
