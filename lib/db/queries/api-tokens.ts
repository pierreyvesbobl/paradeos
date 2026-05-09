import "server-only";

import { createHash } from "node:crypto";
import { userApiTokens } from "@/db/schema/user-api-tokens";
import { db } from "@/lib/db/server";
import { and, desc, eq, isNull } from "drizzle-orm";

/** Hash SHA-256 hex pour comparer un token brut à ce qu'on a en base. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getTokensForUser(userId: string) {
  const conn = await db();
  return conn
    .select({
      id: userApiTokens.id,
      label: userApiTokens.label,
      lastUsedAt: userApiTokens.lastUsedAt,
      createdAt: userApiTokens.createdAt,
      revokedAt: userApiTokens.revokedAt,
    })
    .from(userApiTokens)
    .where(eq(userApiTokens.userId, userId))
    .orderBy(desc(userApiTokens.createdAt));
}

/**
 * Résolution token → user_id pour l'auth des requêtes HTTP MCP.
 * Met à jour `last_used_at` en fire-and-forget. Renvoie null si le
 * token est inconnu ou révoqué.
 */
export async function resolveToken(
  token: string,
): Promise<{ userId: string; tokenId: string } | null> {
  const conn = await db();
  const hash = hashToken(token);
  const [row] = await conn
    .select({ id: userApiTokens.id, userId: userApiTokens.userId })
    .from(userApiTokens)
    .where(and(eq(userApiTokens.tokenHash, hash), isNull(userApiTokens.revokedAt)))
    .limit(1);
  if (!row) return null;

  // Best-effort touch — pas await pour ne pas ralentir la requête.
  conn
    .update(userApiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(userApiTokens.id, row.id))
    .catch(() => undefined);

  return { userId: row.userId, tokenId: row.id };
}
