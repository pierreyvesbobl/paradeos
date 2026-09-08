import {
  linkedinConnections,
  linkedinConversations,
  linkedinSyncState,
} from "@/db/schema/linkedin";
import { db } from "@/lib/db/server";
import { getLinkedinSyncTokensForUser } from "@/lib/linkedin/sync-tokens";
import { and, count, eq } from "drizzle-orm";

export type LinkedinSettingsSummary = {
  syncTokens: { id: string; label: string; createdAt: string; lastUsedAt: string | null }[];
  lastConversationsSyncAt: string | null;
  lastConnectionsSyncAt: string | null;
  lastError: string | null;
  conversationCount: number;
  pendingMatchCount: number;
};

/**
 * Tout ce que la section LinkedIn des réglages a besoin d'afficher, en
 * une passe. La date de dernière synchro n'est pas cosmétique : c'est
 * le seul signal qui trahit une extension qui a cessé de tourner —
 * il n'y a pas de cron serveur pour prendre le relais.
 */
export async function getLinkedinSettingsSummary(userId: string): Promise<LinkedinSettingsSummary> {
  const conn = await db();

  const [tokens, [state], [convCount], [pendingCount]] = await Promise.all([
    getLinkedinSyncTokensForUser(userId),
    conn
      .select({
        lastConversationsSyncAt: linkedinSyncState.lastConversationsSyncAt,
        lastConnectionsSyncAt: linkedinSyncState.lastConnectionsSyncAt,
        lastError: linkedinSyncState.lastError,
      })
      .from(linkedinSyncState)
      .where(eq(linkedinSyncState.userId, userId))
      .limit(1),
    conn
      .select({ value: count() })
      .from(linkedinConversations)
      .where(eq(linkedinConversations.userId, userId)),
    conn
      .select({ value: count() })
      .from(linkedinConnections)
      .where(
        and(eq(linkedinConnections.userId, userId), eq(linkedinConnections.matchStatus, "pending")),
      ),
  ]);

  return {
    syncTokens: tokens
      .filter((t) => !t.revokedAt)
      .map((t) => ({
        id: t.id,
        label: t.label,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      })),
    lastConversationsSyncAt: state?.lastConversationsSyncAt?.toISOString() ?? null,
    lastConnectionsSyncAt: state?.lastConnectionsSyncAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    conversationCount: convCount?.value ?? 0,
    pendingMatchCount: pendingCount?.value ?? 0,
  };
}
