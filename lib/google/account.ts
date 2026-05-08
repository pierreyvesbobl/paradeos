import "server-only";

import { googleAccounts } from "@/db/schema/google-accounts";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db/server";
import { refreshAccessToken } from "@/lib/google/oauth";
import { and, eq, isNull } from "drizzle-orm";

/** Marge avant expiration où on rafraîchit prophylactiquement. */
const REFRESH_GRACE_MS = 60_000;

export async function getGoogleAccount(userId: string) {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.userId, userId), isNull(googleAccounts.revokedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Renvoie un access_token Google valide pour le user, en le
 * rafraîchissant et persistant si nécessaire. Renvoie `null` si pas
 * de compte connecté.
 *
 * Si le refresh échoue (révocation côté Google, refresh_token expiré),
 * on propage l'erreur — le caller décide quoi faire (surface UI ou
 * marquer le compte révoqué).
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const account = await getGoogleAccount(userId);
  if (!account) return null;

  const expiresAt = account.expiresAt.getTime();
  if (expiresAt - Date.now() > REFRESH_GRACE_MS) {
    return decryptSecret(account.accessTokenEnc);
  }

  const refreshToken = decryptSecret(account.refreshTokenEnc);
  const refreshed = await refreshAccessToken(refreshToken);

  const conn = await db();
  await conn
    .update(googleAccounts)
    .set({
      accessTokenEnc: encryptSecret(refreshed.access_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, account.id));

  return refreshed.access_token;
}
