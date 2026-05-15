import "server-only";

import { createHash } from "node:crypto";
import { dougsSyncTokens } from "@/db/schema/dougs";
import { db } from "@/lib/db/server";
import { and, desc, eq, isNull } from "drizzle-orm";

export const DOUGS_SYNC_TOKEN_PREFIX = "paradeos_dougs_sync_";

export function hashSyncToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getSyncTokensForUser(userId: string) {
  const conn = await db();
  return conn
    .select({
      id: dougsSyncTokens.id,
      label: dougsSyncTokens.label,
      lastUsedAt: dougsSyncTokens.lastUsedAt,
      createdAt: dougsSyncTokens.createdAt,
      revokedAt: dougsSyncTokens.revokedAt,
    })
    .from(dougsSyncTokens)
    .where(eq(dougsSyncTokens.userId, userId))
    .orderBy(desc(dougsSyncTokens.createdAt));
}

/**
 * Résout un token brut → userId. Best-effort touch de last_used_at.
 * Renvoie null si inconnu ou révoqué.
 */
export async function resolveSyncToken(
  token: string,
): Promise<{ userId: string; tokenId: string } | null> {
  const conn = await db();
  const hash = hashSyncToken(token);
  const [row] = await conn
    .select({ id: dougsSyncTokens.id, userId: dougsSyncTokens.userId })
    .from(dougsSyncTokens)
    .where(and(eq(dougsSyncTokens.tokenHash, hash), isNull(dougsSyncTokens.revokedAt)))
    .limit(1);
  if (!row) return null;

  conn
    .update(dougsSyncTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(dougsSyncTokens.id, row.id))
    .catch(() => undefined);

  return { userId: row.userId, tokenId: row.id };
}
