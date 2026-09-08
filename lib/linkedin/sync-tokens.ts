import "server-only";

import { createHash } from "node:crypto";
import { linkedinSyncTokens } from "@/db/schema/linkedin";
import { db } from "@/lib/db/server";
import { and, desc, eq, isNull } from "drizzle-orm";

/**
 * Tokens porteurs de l'auth entre l'extension Chrome et Paradeos.
 * Même primitive que `lib/dougs/sync-tokens.ts` : le token brut n'est
 * affiché qu'une fois, seul son SHA-256 est stocké.
 */
export const LINKEDIN_SYNC_TOKEN_PREFIX = "paradeos_linkedin_sync_";

export function hashSyncToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getLinkedinSyncTokensForUser(userId: string) {
  const conn = await db();
  return conn
    .select({
      id: linkedinSyncTokens.id,
      label: linkedinSyncTokens.label,
      lastUsedAt: linkedinSyncTokens.lastUsedAt,
      createdAt: linkedinSyncTokens.createdAt,
      revokedAt: linkedinSyncTokens.revokedAt,
    })
    .from(linkedinSyncTokens)
    .where(eq(linkedinSyncTokens.userId, userId))
    .orderBy(desc(linkedinSyncTokens.createdAt));
}

/**
 * Résout un token brut → userId. Touch best-effort de `last_used_at`
 * (volontairement non attendu : la date d'usage ne doit pas ralentir
 * ni faire échouer une ingestion).
 * Renvoie null si inconnu ou révoqué.
 */
export async function resolveLinkedinSyncToken(
  token: string,
): Promise<{ userId: string; tokenId: string } | null> {
  const conn = await db();
  const hash = hashSyncToken(token);
  const [row] = await conn
    .select({ id: linkedinSyncTokens.id, userId: linkedinSyncTokens.userId })
    .from(linkedinSyncTokens)
    .where(and(eq(linkedinSyncTokens.tokenHash, hash), isNull(linkedinSyncTokens.revokedAt)))
    .limit(1);
  if (!row) return null;

  conn
    .update(linkedinSyncTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(linkedinSyncTokens.id, row.id))
    .catch(() => undefined);

  return { userId: row.userId, tokenId: row.id };
}
