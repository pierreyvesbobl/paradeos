import "server-only";

import {
  dougsOperationMatches,
  dougsOperations,
  purchaseDocuments,
} from "@/db/schema/purchase-matching";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { downloadDriveFile } from "@/lib/google/drive-api";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import {
  DougsAuthError,
  deleteDougsOperationAttachment,
  getDougsOperation,
  uploadDougsOperationAttachment,
} from "./client";
import { type DocumentSide, rankMatchesForOperation } from "./vendor-match";

/**
 * Rapprochement des opérations bancaires sans justificatif avec les
 * factures d'achat du Drive, et dépôt de la pièce chez Dougs quand le
 * rapprochement ne fait aucun doute.
 *
 * RÈGLE NON NÉGOCIABLE : ce module attache des pièces, il ne valide
 * JAMAIS une opération. Après l'upload, l'opération reste « à valider »
 * chez Dougs — c'est un humain qui tranche, après contrôle. Aucun appel
 * de validation ne doit être ajouté ici.
 */

/** Candidats conservés par opération dans la file de validation. */
const CANDIDATES_PER_OPERATION = 4;

export type ReconcileResult = {
  operationsConsidered: number;
  suggestionsWritten: number;
  autoAttached: number;
  attachFailed: number;
  /** Opérations pour lesquelles aucun document du Drive ne convient. */
  withoutCandidate: number;
  /** Session Dougs morte : le run s'arrête proprement, sans rien casser. */
  dougsUnavailable: boolean;
  errors: string[];
};

type DocumentRow = {
  id: string;
  driveFileId: string;
  driveFileName: string;
  amountTtc: string | null;
  invoiceDate: string | null;
  supplierKey: string | null;
};

function documentSideOf(doc: DocumentRow): DocumentSide {
  return {
    amountTtc: doc.amountTtc === null ? null : Number(doc.amountTtc),
    invoiceDate: doc.invoiceDate,
    supplierKey: doc.supplierKey,
  };
}

export async function reconcilePurchaseInvoices(
  userId: string,
  { autoAttach = false }: { autoAttach?: boolean } = {},
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    operationsConsidered: 0,
    suggestionsWritten: 0,
    autoAttached: 0,
    attachFailed: 0,
    withoutCandidate: 0,
    dougsUnavailable: false,
    errors: [],
  };

  const conn = await db();

  // Décaissements à valider, sans pièce jointe : exactement la liste que
  // le workflow manuel allait chercher dans l'UI Dougs.
  const operations = await conn
    .select()
    .from(dougsOperations)
    .where(
      and(
        eq(dougsOperations.userId, userId),
        eq(dougsOperations.attachmentCount, 0),
        eq(dougsOperations.validated, false),
        ne(dougsOperations.isInbound, true),
      ),
    );
  result.operationsConsidered = operations.length;
  if (operations.length === 0) return result;

  // Sans montant, un document ne peut pas être rapproché d'un débit.
  const documents = await conn
    .select({
      id: purchaseDocuments.id,
      driveFileId: purchaseDocuments.driveFileId,
      driveFileName: purchaseDocuments.driveFileName,
      amountTtc: purchaseDocuments.amountTtc,
      invoiceDate: purchaseDocuments.invoiceDate,
      supplierKey: purchaseDocuments.supplierKey,
    })
    .from(purchaseDocuments)
    .where(isNotNull(purchaseDocuments.amountTtc));
  if (documents.length === 0) return result;

  // Décisions déjà prises : une suggestion rejetée à la main ne doit pas
  // revenir à chaque run, et une pièce déjà attachée ne se réattache pas.
  const decided = await conn
    .select({
      operationId: dougsOperationMatches.operationId,
      documentId: dougsOperationMatches.documentId,
      status: dougsOperationMatches.status,
    })
    .from(dougsOperationMatches)
    .where(eq(dougsOperationMatches.userId, userId));

  const decidedPairs = new Map(decided.map((d) => [`${d.operationId}:${d.documentId}`, d.status]));
  const attachedDocuments = new Set(
    decided.filter((d) => d.status === "attached").map((d) => d.documentId),
  );

  const accessToken = autoAttach ? await getValidAccessToken(userId) : null;
  if (autoAttach && !accessToken) {
    result.errors.push("Pas d'access token Google : impossible de lire les PDF à attacher.");
  }

  for (const operation of operations) {
    const ranked = rankMatchesForOperation(
      {
        amount: operation.amount === null ? null : Number(operation.amount),
        date: operation.operationDate,
        wording: operation.wording,
      },
      documents,
      documentSideOf,
      { limit: CANDIDATES_PER_OPERATION },
    );

    if (ranked.length === 0) {
      result.withoutCandidate += 1;
      continue;
    }

    for (const candidate of ranked) {
      const key = `${operation.id}:${candidate.document.id}`;
      const existing = decidedPairs.get(key);
      // On ne réécrit jamais par-dessus une décision humaine.
      if (existing === "rejected" || existing === "attached") continue;

      try {
        await conn
          .insert(dougsOperationMatches)
          .values({
            userId,
            operationId: operation.id,
            documentId: candidate.document.id,
            score: candidate.score.total.toFixed(3),
            scoreBreakdown: candidate.score,
            confidence: candidate.confidence,
            status: "suggested",
          })
          .onConflictDoUpdate({
            target: [dougsOperationMatches.operationId, dougsOperationMatches.documentId],
            set: {
              score: candidate.score.total.toFixed(3),
              scoreBreakdown: candidate.score,
              confidence: candidate.confidence,
              updatedAt: new Date(),
            },
          });
        result.suggestionsWritten += 1;
      } catch (err) {
        result.errors.push(
          `suggestion ${key} : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const best = ranked[0];
    if (!autoAttach || !accessToken || !best || best.confidence !== "certain") continue;
    // Un document déjà posé ailleurs ne part pas tout seul une deuxième
    // fois : le rattachement multiple (loyer trimestriel) reste manuel.
    if (attachedDocuments.has(best.document.id)) continue;

    try {
      await attachDocument({
        userId,
        accessToken,
        operationId: operation.id,
        dougsOperationId: operation.dougsOperationId,
        document: best.document,
      });
      attachedDocuments.add(best.document.id);
      result.autoAttached += 1;
    } catch (err) {
      if (err instanceof DougsAuthError) {
        result.dougsUnavailable = true;
        result.errors.push(err.message);
        return result;
      }
      result.attachFailed += 1;
      result.errors.push(
        `${best.document.driveFileName} → opération ${operation.dougsOperationId} : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return result;
}

/**
 * Dépose un PDF du Drive sur une opération Dougs et enregistre le
 * rattachement.
 *
 * Relit l'opération chez Dougs juste avant l'envoi : entre le dernier
 * snapshot et maintenant, une pièce a pu être posée par l'ancienne chaîne
 * d'automatisation ou depuis l'UI Dougs. Sans ce contrôle, on créerait un
 * doublon de justificatif sur la même dépense.
 */
export async function attachDocument(args: {
  userId: string;
  accessToken: string;
  /** Identifiant local de l'opération (`dougs_operations.id`). */
  operationId: string;
  /** Identifiant Dougs de l'opération. */
  dougsOperationId: number;
  document: { id: string; driveFileId: string; driveFileName: string };
}): Promise<{ attached: boolean; reason?: string }> {
  const conn = await db();

  const live = await getDougsOperation(args.userId, args.dougsOperationId);
  if ((live.sourceDocumentAttachments?.length ?? 0) > 0) {
    await conn
      .update(dougsOperations)
      .set({ attachmentCount: live.sourceDocumentAttachments?.length ?? 0 })
      .where(eq(dougsOperations.id, args.operationId));
    return { attached: false, reason: "L'opération a déjà un justificatif chez Dougs." };
  }

  const pdf = await downloadDriveFile(args.document.driveFileId, args.accessToken);
  const attachment = await uploadDougsOperationAttachment(args.userId, args.dougsOperationId, {
    filename: args.document.driveFileName,
    bytes: pdf,
    contentType: guessContentType(args.document.driveFileName),
  });

  await conn
    .update(dougsOperationMatches)
    .set({
      status: "attached",
      dougsAttachmentId: attachment?.id === undefined ? null : String(attachment.id),
      attachedAt: new Date(),
      errorMessage: null,
    })
    .where(
      and(
        eq(dougsOperationMatches.operationId, args.operationId),
        eq(dougsOperationMatches.documentId, args.document.id),
      ),
    );

  // Le snapshot reflète la réalité sans attendre le prochain sync : la
  // file de justificatifs se vide sous les yeux de l'utilisateur.
  await conn
    .update(dougsOperations)
    .set({ attachmentCount: 1 })
    .where(eq(dougsOperations.id, args.operationId));

  return { attached: true };
}

/** Retire une pièce posée par erreur, côté Dougs et côté base. */
export async function detachDocument(args: {
  userId: string;
  matchId: string;
}): Promise<{ detached: boolean; reason?: string }> {
  const conn = await db();
  const [match] = await conn
    .select({
      id: dougsOperationMatches.id,
      operationId: dougsOperationMatches.operationId,
      dougsAttachmentId: dougsOperationMatches.dougsAttachmentId,
      dougsOperationId: dougsOperations.dougsOperationId,
    })
    .from(dougsOperationMatches)
    .innerJoin(dougsOperations, eq(dougsOperations.id, dougsOperationMatches.operationId))
    .where(
      and(
        eq(dougsOperationMatches.id, args.matchId),
        eq(dougsOperationMatches.userId, args.userId),
      ),
    )
    .limit(1);

  if (!match) return { detached: false, reason: "Rapprochement introuvable." };
  if (!match.dougsAttachmentId) {
    return {
      detached: false,
      reason: "Dougs n'a pas renvoyé d'identifiant de pièce : à retirer depuis Dougs.",
    };
  }

  await deleteDougsOperationAttachment(
    args.userId,
    match.dougsOperationId,
    match.dougsAttachmentId,
  );

  await conn
    .update(dougsOperationMatches)
    .set({ status: "suggested", dougsAttachmentId: null, attachedAt: null })
    .where(eq(dougsOperationMatches.id, args.matchId));
  await conn
    .update(dougsOperations)
    .set({ attachmentCount: 0 })
    .where(eq(dougsOperations.id, match.operationId));

  return { detached: true };
}

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  return "application/pdf";
}
