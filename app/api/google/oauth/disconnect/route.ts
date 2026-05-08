import { googleAccounts } from "@/db/schema/google-accounts";
import { requireUser } from "@/lib/auth/server";
import { decryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db/server";
import { revokeToken } from "@/lib/google/oauth";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Déconnecte le compte Google : revoke le refresh_token côté Google
 * puis supprime la ligne. On hard-delete plutôt que `revoked_at` parce
 * que l'`UNIQUE(user_id)` empêcherait sinon une nouvelle connexion.
 *
 * POST avec form encoded (déclenché par un `<form action=...>` côté UI).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  const conn = await db();

  const [row] = await conn
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.userId, user.id), isNull(googleAccounts.revokedAt)))
    .limit(1);

  if (row) {
    try {
      const refresh = decryptSecret(row.refreshTokenEnc);
      await revokeToken(refresh);
    } catch (err) {
      console.warn("[google oauth] revoke failed", err);
    }
    await conn.delete(googleAccounts).where(eq(googleAccounts.id, row.id));
  }

  return NextResponse.redirect(new URL("/settings/integrations?google=disconnected", req.url), 303);
}
