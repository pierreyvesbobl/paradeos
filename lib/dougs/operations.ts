import "server-only";

import { dougsOperations } from "@/db/schema/purchase-matching";
import { db } from "@/lib/db/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { type DougsOperation, listDougsOperations } from "./client";

/**
 * Recopie en base les opérations bancaires « à valider » de Dougs.
 *
 * Pourquoi un snapshot plutôt qu'une lecture directe : le cron travaille
 * hors requête utilisateur, la file de validation a besoin de lignes
 * stables sur lesquelles accrocher une décision, et Dougs — API interne
 * derrière Cloudflare, cookie qui expire toutes les 24 h — ne doit jamais
 * faire tomber la page (cf. `lib/dougs/signals.ts`).
 */

const PAGE_SIZE = 100;

/** Garde-fou : au-delà, c'est que la pagination ne progresse plus. */
const MAX_PAGES = 20;

/** Pause entre deux pages, pour rester poli avec le Cloudflare de Dougs. */
const PAGE_DELAY_MS = 150;

export type OperationsSyncResult = {
  fetched: number;
  inserted: number;
  updated: number;
  /** Opérations disparues de Dougs (validées ailleurs, supprimées). */
  pruned: number;
  errors: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Montant signé : Dougs le donne tantôt dans `signedAmount`, tantôt dans `amount`. */
function signedAmountOf(op: DougsOperation): number | null {
  const signed = typeof op.signedAmount === "number" ? op.signedAmount : null;
  if (signed !== null) return signed;
  const amount = typeof op.amount === "number" ? op.amount : null;
  if (amount === null) return null;
  // Sans `signedAmount`, c'est `isInbound` qui porte le sens.
  if (op.isInbound === false) return -Math.abs(amount);
  if (op.isInbound === true) return Math.abs(amount);
  return amount;
}

function isInboundOf(op: DougsOperation): boolean | null {
  if (typeof op.isInbound === "boolean") return op.isInbound;
  const signed = signedAmountOf(op);
  if (signed === null) return null;
  return signed > 0;
}

export async function syncDougsOperations(
  userId: string,
  { pages = MAX_PAGES }: { pages?: number } = {},
): Promise<OperationsSyncResult> {
  const result: OperationsSyncResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    pruned: 0,
    errors: [],
  };

  const fetched: DougsOperation[] = [];
  for (let page = 0; page < pages; page++) {
    const batch = await listDougsOperations(userId, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      validated: false,
      needsAttention: false,
    });
    fetched.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }
  result.fetched = fetched.length;
  if (fetched.length === 0) return result;

  const conn = await db();
  const known = await conn
    .select({
      id: dougsOperations.id,
      dougsOperationId: dougsOperations.dougsOperationId,
    })
    .from(dougsOperations)
    .where(eq(dougsOperations.userId, userId));
  const knownIds = new Set(known.map((k) => k.dougsOperationId));

  const syncedAt = new Date();
  for (const op of fetched) {
    const dougsOperationId = Number(op.id);
    if (!Number.isFinite(dougsOperationId)) continue;

    const signed = signedAmountOf(op);
    const row = {
      userId,
      dougsOperationId,
      operationDate: op.date ? op.date.slice(0, 10) : null,
      amount: signed === null ? null : signed.toFixed(2),
      wording: op.wording ?? null,
      isInbound: isInboundOf(op),
      validated: op.validated === true,
      attachmentCount: op.sourceDocumentAttachments?.length ?? 0,
      syncedAt,
    };

    try {
      await conn
        .insert(dougsOperations)
        .values(row)
        .onConflictDoUpdate({
          target: [dougsOperations.userId, dougsOperations.dougsOperationId],
          set: {
            operationDate: row.operationDate,
            amount: row.amount,
            wording: row.wording,
            isInbound: row.isInbound,
            validated: row.validated,
            attachmentCount: row.attachmentCount,
            syncedAt,
            updatedAt: new Date(),
          },
        });
      if (knownIds.has(dougsOperationId)) result.updated += 1;
      else result.inserted += 1;
    } catch (err) {
      result.errors.push(
        `opération ${dougsOperationId} : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Une opération qui n'est plus renvoyée par Dougs a été validée (ou
  // supprimée) : elle n'a plus rien à faire dans la file de justificatifs.
  // On la reconnaît à son `synced_at` resté en arrière. Seulement si la
  // passe s'est bien déroulée — sur un appel partiel, l'absence ne
  // prouverait rien.
  if (result.errors.length === 0) {
    const stale = await conn
      .delete(dougsOperations)
      .where(
        and(
          eq(dougsOperations.userId, userId),
          or(lt(dougsOperations.syncedAt, syncedAt), isNull(dougsOperations.syncedAt)),
        ),
      )
      .returning({ id: dougsOperations.id });
    result.pruned = stale.length;
  }

  return result;
}
