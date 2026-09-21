import "server-only";

import { purchaseDocuments } from "@/db/schema/purchase-matching";
import { pMap } from "@/lib/async/p-map";
import { db } from "@/lib/db/server";
import { extractInvoiceMetadata } from "@/lib/gmail/invoice-extract";
import { extractPdfText } from "@/lib/gmail/pdf";
import { normalizeSupplierKey } from "@/lib/gmail/supplier-key";
import { getValidAccessToken } from "@/lib/google/account";
import { downloadDriveFile } from "@/lib/google/drive-api";
import { asc, eq, sql } from "drizzle-orm";
import { normalizeCurrency, normalizeInvoiceNumber, toAmountColumn } from "./amounts";
import { condenseInvoiceText, isPermanentExtractionFailure } from "./pdf-triage";

/**
 * Capture des montants sur les factures du Drive que la chaîne Gmail ne
 * connaît pas — celles déposées par l'ancienne automatisation, et celles
 * classées avant que l'extraction ne lise les montants.
 *
 * On relit le PDF depuis Drive plutôt que depuis Gmail : c'est le seul
 * chemin qui marche pour les deux origines, et le texte du PDF n'est
 * stocké nulle part.
 */

/** En dessous, il n'y a pas de couche texte : c'est un scan, pas la peine d'appeler le LLM. */
const MIN_TEXT_LENGTH = 30;

/** Passages LLM avant d'abandonner un document pour de bon. */
const MAX_EXTRACTION_ATTEMPTS = 3;

export type BackfillResult = {
  processed: number;
  extracted: number;
  unparseable: number;
  failed: number;
  /** Erreurs transitoires remises en file plutôt que déclarées échecs. */
  retried: number;
  /** Documents du lot laissés de côté faute de temps — repris au run suivant. */
  skippedForTime: number;
  errors: string[];
};

/**
 * Traite un lot de documents en attente de montants.
 *
 * File d'attente drainée par les plus anciens : un run interrompu ne
 * repart jamais de zéro, et les documents jamais traités passent en
 * premier (`extracted_at nulls first`).
 */
export async function backfillPurchaseAmounts(
  userId: string,
  {
    limit = 60,
    concurrency = 8,
    /**
     * Instant (epoch ms) au-delà duquel on n'entame plus de document. Une
     * fonction Vercel est tuée à `maxDuration` sans rien rendre : mieux
     * vaut s'arrêter tôt et renvoyer un bilan que perdre le run entier.
     */
    deadline,
  }: { limit?: number; concurrency?: number; deadline?: number } = {},
): Promise<BackfillResult> {
  const result: BackfillResult = {
    processed: 0,
    extracted: 0,
    unparseable: 0,
    failed: 0,
    retried: 0,
    skippedForTime: 0,
    errors: [],
  };

  const conn = await db();
  const pending = await conn
    .select({
      id: purchaseDocuments.id,
      driveFileId: purchaseDocuments.driveFileId,
      driveFileName: purchaseDocuments.driveFileName,
      supplierLabel: purchaseDocuments.supplierLabel,
      invoiceDate: purchaseDocuments.invoiceDate,
      attempts: purchaseDocuments.extractionAttempts,
    })
    .from(purchaseDocuments)
    .where(
      // Pas de filtre `user_id` : l'inventaire est company-wide (cf.
      // db/schema/purchase-matching.ts), le filtrer ferait manquer les
      // lignes écrites sous un autre compte.
      eq(purchaseDocuments.extractionStatus, "pending"),
    )
    .orderBy(
      sql`${purchaseDocuments.extractedAt} asc nulls first`,
      asc(purchaseDocuments.createdAt),
    )
    .limit(limit);

  if (pending.length === 0) return result;

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    result.errors.push("Pas d'access token Google pour cet utilisateur.");
    return result;
  }

  // Concurrence bornée : le temps d'un document est presque entièrement
  // l'appel LLM. En série, un lot dépasse la durée max d'une fonction
  // Vercel ; de front, il tient. Plafonné quand même pour ne pas se faire
  // rate-limiter par OpenRouter.
  await pMap(
    pending,
    async (doc) => {
      if (deadline && Date.now() > deadline) {
        result.skippedForTime += 1;
        return;
      }
      result.processed += 1;
      const attempts = doc.attempts + 1;
      try {
        const pdf = await downloadDriveFile(doc.driveFileId, accessToken);
        const text = await extractPdfText(pdf);

        if (text.trim().length < MIN_TEXT_LENGTH) {
          await conn
            .update(purchaseDocuments)
            .set({
              extractionStatus: "unparseable",
              extractedAt: new Date(),
              extractionAttempts: attempts,
              errorMessage: "PDF sans couche texte (probablement un scan).",
            })
            .where(eq(purchaseDocuments.id, doc.id));
          result.unparseable += 1;
          return;
        }

        const meta = await extractInvoiceMetadata({
          emailSubject: null,
          emailFrom: null,
          emailBody: null,
          pdfFilename: doc.driveFileName,
          pdfText: condenseInvoiceText(text),
          otherAttachments: [],
        });

        // Le fournisseur lu sur la facture est plus fiable que celui déduit
        // du dossier — mais on ne remplace que si le LLM en a trouvé un.
        const supplierLabel = meta.supplierName ?? doc.supplierLabel;

        await conn
          .update(purchaseDocuments)
          .set({
            amountTtc: toAmountColumn(meta.totalTtc),
            amountHt: toAmountColumn(meta.totalHt),
            vatAmount: toAmountColumn(meta.vatAmount),
            currency: normalizeCurrency(meta.currency),
            invoiceNumber: normalizeInvoiceNumber(meta.invoiceNumber),
            supplierLabel,
            supplierKey: supplierLabel ? normalizeSupplierKey(supplierLabel) : null,
            invoiceDate: meta.invoiceDate ?? doc.invoiceDate,
            extractionStatus: "done",
            extractedAt: new Date(),
            extractionAttempts: attempts,
            errorMessage: null,
          })
          .where(eq(purchaseDocuments.id, doc.id));
        result.extracted += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Un timeout réseau ou un 429 OpenRouter n'est pas un verdict sur
        // le document : on le remet en file, en queue de peloton
        // (`extracted_at` horodaté, et l'ordre est `asc nulls first`).
        // On n'abandonne qu'après plusieurs passages infructueux.
        const permanent = isPermanentExtractionFailure(message);
        const giveUp = permanent || attempts >= MAX_EXTRACTION_ATTEMPTS;
        await conn
          .update(purchaseDocuments)
          .set({
            extractionStatus: permanent ? "unparseable" : giveUp ? "failed" : "pending",
            extractedAt: new Date(),
            extractionAttempts: attempts,
            errorMessage: message.slice(0, 500),
          })
          .where(eq(purchaseDocuments.id, doc.id));
        if (permanent) {
          result.unparseable += 1;
        } else if (giveUp) {
          result.failed += 1;
          result.errors.push(`${doc.driveFileName} : ${message}`);
        } else {
          result.retried += 1;
        }
      }
    },
    concurrency,
  );

  return result;
}
