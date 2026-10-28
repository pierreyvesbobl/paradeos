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

import { asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { gmailSyncState } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { cronResponse, cronRun, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import { SYNC_TIME_BUDGET_MS, syncIncremental } from "@/lib/gmail/sync";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Budget total du run, sous `maxDuration` avec la place pour le
 * débordement d'un dernier appel LLM et la persistance de l'état (cf.
 * `SYNC_TIME_BUDGET_MS`). Réparti entre les utilisateurs : chacun reçoit
 * une part égale du temps restant, et ce qu'un run rapide n'a pas
 * consommé profite au suivant. Avant cette marge, un utilisateur pouvait
 * entamer une extraction à la dernière seconde, la fonction mourait à
 * 300 s et la boîte suivante n'était jamais relue.
 */
const RUN_BUDGET_MS = SYNC_TIME_BUDGET_MS;

async function run(request: Request): Promise<Response> {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const conn = await db();
    // La boîte relue il y a le plus longtemps passe en premier : si le
    // run manque de temps, c'est la plus fraîche qui attend.
    const candidates = await conn
      .select({ userId: users.id, scopes: googleAccounts.scopes })
      .from(users)
      .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .leftJoin(gmailSyncState, eq(gmailSyncState.userId, users.id))
      .where(eq(users.role, "admin"))
      .orderBy(sql`${gmailSyncState.lastIncrementalAt} asc nulls first`, asc(users.createdAt));
    const targets = candidates.filter((c) => hasRequiredGmailScopes(c.scopes));

    if (targets.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no admin with gmail scope" });
    }

    const results: Array<{
      userId: string;
      mode: string;
      inserted: number;
      bodiesFetched: number;
      skippedSpam: number;
      skippedNotFound: number;
      skippedDrafts: number;
      invoiceCandidatesIngested: number;
      invoicesRecovered: number;
      invoicesFiled: number;
      invoicesRejected: number;
      invoicesErrored: number;
      candidaturesQueued: number;
      candidaturesReplied: number;
      candidaturesRejected: number;
      candidaturesErrored: number;
      proposalsExpired: number;
      threadsArchived: number;
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
        skippedSpam: r.skippedSpam,
        skippedNotFound: r.skippedNotFound,
        skippedDrafts: r.skippedDrafts,
        invoiceCandidatesIngested: r.invoiceCandidatesIngested,
        invoicesRecovered: r.invoicesRecovered,
        invoicesFiled: r.invoicesFiled,
        invoicesRejected: r.invoicesRejected,
        invoicesErrored: r.invoicesErrored,
        candidaturesQueued: r.candidaturesQueued,
        candidaturesReplied: r.candidaturesReplied,
        candidaturesRejected: r.candidaturesRejected,
        candidaturesErrored: r.candidaturesErrored,
        proposalsExpired: r.proposalsExpired,
        threadsArchived: r.threadsArchived,
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

/** `?detach=1` : répond tout de suite, le travail continue (cf. `cronRun`). */
export function GET(request: Request) {
  return cronRun(request, () => run(request));
}
