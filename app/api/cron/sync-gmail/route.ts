/**
 * Cron : ingère les nouveaux threads/messages Gmail pour l'utilisateur
 * admin connecté au scope gmail.readonly.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>` (Vercel le pose auto).
 * Déclenché par le cron Vercel quotidien (6 h 30, filet de sécurité) et,
 * plusieurs fois par jour, par `.github/workflows/crons.yml` — Hobby
 * plafonne Vercel à un passage par jour (cf. docs/cron-external.md). Le
 * verrou de `syncIncremental` rend les appels concurrents inoffensifs.
 * Pendant le bootstrap initial (3 derniers mois), le run peut aussi être
 * appelé à la main via le bouton "Sync now" pour drainer plus vite (cf.
 * `lib/actions/gmail.ts:triggerGmailSync`).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import { syncIncremental } from "@/lib/gmail/sync";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Budget total du run, sous `maxDuration` avec de la marge pour la
 * persistance de l'état et la réponse. Réparti entre les utilisateurs :
 * chacun reçoit une part égale du temps restant, et ce qu'un run rapide
 * n'a pas consommé profite au suivant.
 */
const RUN_BUDGET_MS = 270_000;

export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

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
      invoiceCandidatesIngested: number;
      invoicesRecovered: number;
      invoicesFiled: number;
      invoicesRejected: number;
      invoicesErrored: number;
      candidaturesQueued: number;
      candidaturesReplied: number;
      candidaturesRejected: number;
      candidaturesErrored: number;
      errors: string[];
      hasMore: boolean;
      budgetExhausted: boolean;
      timings: Record<string, number>;
    }> = [];

    const runDeadline = Date.now() + RUN_BUDGET_MS;
    for (const [i, t] of targets.entries()) {
      const remaining = Math.max(0, runDeadline - Date.now());
      const deadline = Date.now() + remaining / (targets.length - i);
      const r = await syncIncremental(t.userId, { deadline });
      results.push({
        userId: t.userId,
        mode: r.mode,
        inserted: r.inserted,
        bodiesFetched: r.bodiesFetched,
        invoiceCandidatesIngested: r.invoiceCandidatesIngested,
        invoicesRecovered: r.invoicesRecovered,
        invoicesFiled: r.invoicesFiled,
        invoicesRejected: r.invoicesRejected,
        invoicesErrored: r.invoicesErrored,
        candidaturesQueued: r.candidaturesQueued,
        candidaturesReplied: r.candidaturesReplied,
        candidaturesRejected: r.candidaturesRejected,
        candidaturesErrored: r.candidaturesErrored,
        errors: r.errors,
        hasMore: r.hasMore,
        budgetExhausted: r.budgetExhausted,
        timings: r.timings,
      });
    }

    const errors = results.flatMap((r) => r.errors.map((e) => `${r.userId}: ${e}`));
    return cronResponse({
      succeeded: results.filter((r) => r.errors.length === 0).length,
      failed: results.filter((r) => r.errors.length > 0).length,
      errors,
      results,
    });
  } catch (err) {
    console.error("[cron sync-gmail]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
