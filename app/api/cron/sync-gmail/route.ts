/**
 * Cron daily : ingère les nouveaux threads/messages Gmail pour
 * l'utilisateur admin connecté au scope gmail.readonly.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>` (Vercel le pose auto).
 * Hobby tier : 1 exécution / jour. Pendant le bootstrap initial (3
 * derniers mois), le run peut être appelé plusieurs fois manuellement
 * via le bouton "Sync now" pour drainer plus vite (cf.
 * `lib/actions/gmail.ts:triggerGmailSync`).
 */
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { syncIncremental } from "@/lib/gmail/sync";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const conn = await db();
    const candidates = await conn
      .select({ userId: users.id, scopes: googleAccounts.scopes })
      .from(users)
      .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .where(eq(users.role, "admin"));
    const targets = candidates.filter((c) => hasRequiredGmailScopes(c.scopes));

    if (targets.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no admin with gmail scope" });
    }

    const results: Array<{
      userId: string;
      mode: string;
      inserted: number;
      bodiesFetched: number;
      errors: string[];
      hasMore: boolean;
    }> = [];

    for (const t of targets) {
      const r = await syncIncremental(t.userId);
      results.push({
        userId: t.userId,
        mode: r.mode,
        inserted: r.inserted,
        bodiesFetched: r.bodiesFetched,
        errors: r.errors,
        hasMore: r.hasMore,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[cron sync-gmail]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
