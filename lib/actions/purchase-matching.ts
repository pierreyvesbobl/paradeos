"use server";

import {
  dougsOperationMatches,
  dougsOperations,
  purchaseDocuments,
} from "@/db/schema/purchase-matching";
import { db } from "@/lib/db/server";
import { DougsAuthError } from "@/lib/dougs/client";
import { syncDougsOperations } from "@/lib/dougs/operations";
import {
  attachDocument,
  detachDocument,
  reconcilePurchaseInvoices,
} from "@/lib/dougs/vendor-reconcile";
import { getValidAccessToken } from "@/lib/google/account";
import { backfillPurchaseAmounts } from "@/lib/purchase/extract-amounts";
import { syncPurchaseInventory } from "@/lib/purchase/inventory";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "./action";

/**
 * Actions de la file des justificatifs.
 *
 * Aucune ne valide une opération Dougs — elles posent ou retirent des
 * pièces, rien d'autre. La validation comptable reste un geste humain,
 * fait depuis Dougs.
 */

/**
 * Attache un document du Drive à une opération, à la demande.
 *
 * Passe par le même chemin que l'attachement automatique
 * (`attachDocument`), donc avec le même garde-fou : relecture de
 * l'opération chez Dougs juste avant l'envoi, pour ne pas doubler un
 * justificatif posé entre-temps.
 */
export const attachDocumentToOperation = action(
  z.object({ matchId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [match] = await conn
      .select({
        operationId: dougsOperationMatches.operationId,
        documentId: dougsOperationMatches.documentId,
        dougsOperationId: dougsOperations.dougsOperationId,
        driveFileId: purchaseDocuments.driveFileId,
        driveFileName: purchaseDocuments.driveFileName,
      })
      .from(dougsOperationMatches)
      .innerJoin(dougsOperations, eq(dougsOperations.id, dougsOperationMatches.operationId))
      .innerJoin(purchaseDocuments, eq(purchaseDocuments.id, dougsOperationMatches.documentId))
      .where(
        and(eq(dougsOperationMatches.id, input.matchId), eq(dougsOperationMatches.userId, user.id)),
      )
      .limit(1);

    if (!match) return { ok: false as const, message: "Rapprochement introuvable." };

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return { ok: false as const, message: "Compte Google non connecté." };
    }

    try {
      const outcome = await attachDocument({
        userId: user.id,
        accessToken,
        operationId: match.operationId,
        dougsOperationId: match.dougsOperationId,
        document: {
          id: match.documentId,
          driveFileId: match.driveFileId,
          driveFileName: match.driveFileName,
        },
      });
      revalidatePath("/compta");
      return outcome.attached
        ? { ok: true as const, message: `${match.driveFileName} attachée.` }
        : { ok: false as const, message: outcome.reason ?? "Rien n'a été attaché." };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await conn
        .update(dougsOperationMatches)
        .set({ status: "failed", errorMessage: message.slice(0, 500) })
        .where(eq(dougsOperationMatches.id, input.matchId));
      revalidatePath("/compta");
      return { ok: false as const, message };
    }
  },
);

/** Retire une pièce posée par erreur, chez Dougs comme en base. */
export const detachOperationAttachment = action(
  z.object({ matchId: z.string().uuid() }),
  async ({ input, user }) => {
    const outcome = await detachDocument({ userId: user.id, matchId: input.matchId });
    revalidatePath("/compta");
    return outcome.detached
      ? { ok: true as const, message: "Pièce détachée." }
      : { ok: false as const, message: outcome.reason ?? "Rien n'a été détaché." };
  },
);

/**
 * Écarte une suggestion. Le rejet est définitif : le rapprochement ne la
 * reproposera plus, même après un nouveau calcul.
 */
export const rejectMatch = action(
  z.object({ matchId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    await conn
      .update(dougsOperationMatches)
      .set({ status: "rejected" })
      .where(
        and(eq(dougsOperationMatches.id, input.matchId), eq(dougsOperationMatches.userId, user.id)),
      );
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

/** Remet une suggestion écartée dans la file. */
export const restoreMatch = action(
  z.object({ matchId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    await conn
      .update(dougsOperationMatches)
      .set({ status: "suggested" })
      .where(
        and(eq(dougsOperationMatches.id, input.matchId), eq(dougsOperationMatches.userId, user.id)),
      );
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

/**
 * Relance le rapprochement à la demande.
 *
 * Le cron ne tourne qu'une fois par jour (limite Vercel Hobby) : ce
 * bouton sert à voir tout de suite l'effet d'une facture qui vient
 * d'arriver, ou d'une session Dougs qu'on vient de rafraîchir.
 *
 * N'attache jamais automatiquement, même si le réglage global est
 * ouvert : une relance manuelle doit rendre la main sur des propositions,
 * pas poser des pièces dans le dos de celui qui a cliqué.
 */
export const runPurchaseMatchingNow = action(
  z.object({ withBackfill: z.boolean().optional() }),
  async ({ input, user }) => {
    const inventory = await syncPurchaseInventory(user.id);

    const backfill = input.withBackfill
      ? await backfillPurchaseAmounts(user.id, { limit: 20, deadline: Date.now() + 60_000 })
      : null;

    try {
      const operations = await syncDougsOperations(user.id);
      const reconciled = await reconcilePurchaseInvoices(user.id, { autoAttach: false });
      revalidatePath("/compta");
      return {
        ok: true as const,
        scanned: inventory.scanned,
        extracted: backfill?.extracted ?? 0,
        operations: operations.fetched,
        suggestions: reconciled.suggestionsWritten,
        withoutCandidate: reconciled.withoutCandidate,
      };
    } catch (err) {
      revalidatePath("/compta");
      if (err instanceof DougsAuthError) {
        return { ok: false as const, message: err.message };
      }
      throw err;
    }
  },
);

/** Ouvre ou ferme l'attachement automatique du cron. */
export const setPurchaseAutoAttach = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await setSetting(SETTING_KEYS.PURCHASE_AUTO_ATTACH_ENABLED, String(input.enabled), user.id);
    revalidatePath("/compta");
    return { ok: true as const };
  },
);
