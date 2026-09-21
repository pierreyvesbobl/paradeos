/**
 * Cron quotidien : rapproche les factures d'achat du Drive avec les
 * opérations bancaires Dougs, et attache le justificatif quand le match
 * est certain.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>` (Vercel le pose auto).
 * Hobby tier : 1 exécution / jour (cf. vercel.json). Pour relancer entre
 * deux, le bouton « Lancer le rapprochement » de /compta.
 *
 * Enchaînement, dans cet ordre parce que chaque étape nourrit la suivante :
 *   1. inventaire du Drive       → quels PDF existent
 *   2. backfill des montants     → combien vaut chacun
 *   3. snapshot des opérations   → quels débits n'ont pas de justificatif
 *   4. rapprochement             → qui va avec quoi, et upload des certains
 *
 * Règle non négociable de l'étape 4 : on attache, on ne valide jamais.
 */
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import { DougsAuthError } from "@/lib/dougs/client";
import { syncDougsOperations } from "@/lib/dougs/operations";
import { reconcilePurchaseInvoices } from "@/lib/dougs/vendor-reconcile";
import { hasRequiredDriveScopes } from "@/lib/google/oauth";
import { backfillPurchaseAmounts } from "@/lib/purchase/extract-amounts";
import { pickInventoryOwner, syncPurchaseInventory } from "@/lib/purchase/inventory";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Documents passés au LLM par run. Borne le coût autant que la durée. */
const BACKFILL_BATCH = 60;

/**
 * Marge gardée sous `maxDuration` : au-delà, on arrête d'entamer des
 * documents et on rend un bilan. Une fonction tuée par la plateforme ne
 * rend rien du tout — ni stats, ni log exploitable.
 */
const TIME_BUDGET_MS = 240_000;

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  const stats = {
    driveScanned: 0,
    driveInserted: 0,
    driveUpdated: 0,
    duplicatePaths: 0,
    drivePruned: 0,
    amountsExtracted: 0,
    amountsUnparseable: 0,
    amountsFailed: 0,
    amountsRetried: 0,
    amountsSkippedForTime: 0,
    operationsFetched: 0,
    operationsPruned: 0,
    operationsConsidered: 0,
    suggestionsWritten: 0,
    autoAttached: 0,
    attachFailed: 0,
    withoutCandidate: 0,
    dougsUnavailable: false,
    errors: [] as string[],
  };

  try {
    const conn = await db();
    const candidates = await conn
      .select({ userId: users.id, scopes: googleAccounts.scopes })
      .from(users)
      .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .where(eq(users.role, "admin"));
    const eligible = candidates.filter((c) => hasRequiredDriveScopes(c.scopes));

    if (eligible.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no admin with drive scope" });
    }

    // Le Drive comptable est UN dossier d'entreprise, pas un dossier par
    // associé : on le scanne une seule fois, au nom d'un seul compte.
    // Boucler sur tous les admins ferait relire — et repayer au LLM — le
    // même millier de PDF autant de fois qu'il y a de comptes Google.
    //
    // On prend celui qui classe déjà les factures depuis Gmail : c'est son
    // Drive qui reçoit les pièces, et ses `invoice_filings` qui portent
    // les montants déjà extraits.
    const target = await pickInventoryOwner(eligible.map((e) => e.userId));
    if (!target) {
      return NextResponse.json({ ok: true, skipped: "no inventory owner" });
    }

    // 1. Inventaire du Drive.
    const inventory = await syncPurchaseInventory(target);
    stats.driveScanned += inventory.scanned;
    stats.driveInserted += inventory.inserted;
    stats.driveUpdated += inventory.updated;
    stats.duplicatePaths += inventory.duplicatePaths;
    stats.drivePruned += inventory.pruned;
    stats.errors.push(...inventory.errors);

    // 2. Montants manquants, par lots.
    const backfill = await backfillPurchaseAmounts(target, {
      limit: BACKFILL_BATCH,
      deadline: startedAt + TIME_BUDGET_MS,
    });
    stats.amountsExtracted += backfill.extracted;
    stats.amountsUnparseable += backfill.unparseable;
    stats.amountsFailed += backfill.failed;
    stats.amountsRetried += backfill.retried;
    stats.amountsSkippedForTime += backfill.skippedForTime;
    stats.errors.push(...backfill.errors);

    // 3 et 4 : Dougs. Isolé du reste — une session expirée (le cookie
    // vit ~24 h) ne doit pas faire passer pour un échec l'inventaire et
    // les montants, qui eux ont bien tourné.
    try {
      const ops = await syncDougsOperations(target);
      stats.operationsFetched += ops.fetched;
      stats.operationsPruned += ops.pruned;
      stats.errors.push(...ops.errors);

      // L'attachement automatique reste fermé tant qu'on ne l'a pas
      // ouvert explicitement : le premier dépôt doit être vérifié à la
      // main dans Dougs avant de laisser le cron poser des pièces.
      const autoAttach = (await getSetting(SETTING_KEYS.PURCHASE_AUTO_ATTACH_ENABLED)) === "true";
      const reconciled = await reconcilePurchaseInvoices(target, { autoAttach });
      stats.operationsConsidered += reconciled.operationsConsidered;
      stats.suggestionsWritten += reconciled.suggestionsWritten;
      stats.autoAttached += reconciled.autoAttached;
      stats.attachFailed += reconciled.attachFailed;
      stats.withoutCandidate += reconciled.withoutCandidate;
      stats.dougsUnavailable ||= reconciled.dougsUnavailable;
      stats.errors.push(...reconciled.errors);
    } catch (err) {
      if (err instanceof DougsAuthError) {
        stats.dougsUnavailable = true;
        stats.errors.push(err.message);
      } else {
        throw err;
      }
    }

    return cronResponse({
      ...stats,
      durationMs: Date.now() - startedAt,
      failed: stats.errors.length,
    });
  } catch (err) {
    console.error("[cron match-purchase-invoices]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown", ...stats },
      { status: 500 },
    );
  }
}
