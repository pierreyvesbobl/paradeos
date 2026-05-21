import "server-only";

import { gmailMessages } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { findOrCreateFolder, uploadFile } from "@/lib/google/drive-api";
import { type GmailAttachmentRef, getAttachment } from "@/lib/google/gmail-api";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { eq } from "drizzle-orm";
import {
  buildInvoiceFilename,
  extractInvoiceMetadata,
  sanitizeForFilename,
} from "./invoice-extract";
import { extractPdfText } from "./pdf";

const PDF_MIME = "application/pdf";

/** Limite pour ne pas tenter de classer des PJ énormes (>20 MB). */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Filtre les PJ candidates au classement. Pour l'instant : PDF
 * uniquement, taille raisonnable. Ignore les pièces inline (filename
 * vide) et les attaches non-PDF (images, archives…).
 */
export function pickInvoicePdfs(refs: GmailAttachmentRef[]): GmailAttachmentRef[] {
  return refs.filter(
    (a) =>
      a.mimeType === PDF_MIME &&
      a.filename.toLowerCase().endsWith(".pdf") &&
      a.size > 0 &&
      a.size <= MAX_PDF_BYTES,
  );
}

/**
 * Enregistre les PJ candidates en base avec status='pending'. Idempotent
 * grâce à la contrainte unique (message_id, gmail_attachment_id).
 */
export async function queueInvoiceCandidates(args: {
  userId: string;
  messageIdLocal: string;
  refs: GmailAttachmentRef[];
}): Promise<number> {
  const candidates = pickInvoicePdfs(args.refs);
  if (candidates.length === 0) return 0;
  const conn = await db();
  const rows = candidates.map((a) => ({
    userId: args.userId,
    messageId: args.messageIdLocal,
    gmailAttachmentId: a.attachmentId,
    originalFilename: a.filename,
  }));
  const result = await conn.insert(invoiceFilings).values(rows).onConflictDoNothing().returning({
    id: invoiceFilings.id,
  });
  return result.length;
}

/**
 * Traite un filing : download PDF → extract text → LLM → upload Drive
 * → update record. Idempotent : si le row est déjà `filed`, on no-op.
 */
export async function processInvoiceFiling(filingId: string): Promise<{
  status: "filed" | "rejected" | "error";
  driveFileId?: string;
  generatedFilename?: string;
  errorMessage?: string;
}> {
  const conn = await db();
  const [filing] = await conn
    .select()
    .from(invoiceFilings)
    .where(eq(invoiceFilings.id, filingId))
    .limit(1);
  if (!filing) throw new Error("Filing introuvable.");
  if (filing.status === "filed") {
    return {
      status: "filed",
      driveFileId: filing.driveFileId ?? undefined,
      generatedFilename: filing.generatedFilename ?? undefined,
    };
  }

  // Garde-fou : on doit avoir le folder racine configuré.
  const rootFolderId = await getSetting(SETTING_KEYS.INVOICE_FILING_ROOT_FOLDER_ID);
  if (!rootFolderId) {
    await markError(filing.id, "INVOICE_FILING_ROOT_FOLDER_ID non configuré.");
    return { status: "error", errorMessage: "INVOICE_FILING_ROOT_FOLDER_ID non configuré." };
  }

  // Charge le message parent pour subject/from/body + gmail_message_id.
  const [msg] = await conn
    .select({
      gmailMessageId: gmailMessages.gmailMessageId,
      subject: gmailMessages.subject,
      fromEmail: gmailMessages.fromEmail,
      fromName: gmailMessages.fromName,
      bodyText: gmailMessages.bodyText,
    })
    .from(gmailMessages)
    .where(eq(gmailMessages.id, filing.messageId))
    .limit(1);
  if (!msg) {
    await markError(filing.id, "message Gmail introuvable.");
    return { status: "error", errorMessage: "message Gmail introuvable." };
  }

  const accessToken = await getValidAccessToken(filing.userId);
  if (!accessToken) {
    await markError(filing.id, "pas d'access token Google.");
    return { status: "error", errorMessage: "pas d'access token Google." };
  }

  // 1. Download PJ
  let pdfBuffer: Buffer;
  try {
    const att = await getAttachment(accessToken, msg.gmailMessageId, filing.gmailAttachmentId);
    pdfBuffer = att.data;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await markError(filing.id, `download attachment: ${errMsg}`);
    return { status: "error", errorMessage: errMsg };
  }

  // 2. Parse PDF
  let pdfText = "";
  try {
    pdfText = await extractPdfText(pdfBuffer);
  } catch (err) {
    // Si le parse échoue (PDF scanné non-OCRisé, corrompu, encrypté),
    // on rejette : pas de métadonnées exploitables côté LLM.
    const errMsg = err instanceof Error ? err.message : String(err);
    await markRejected(filing.id, `parse pdf: ${errMsg}`);
    return { status: "rejected", errorMessage: errMsg };
  }
  if (pdfText.trim().length < 30) {
    await markRejected(filing.id, "PDF sans texte exploitable (probablement scanné).");
    return { status: "rejected", errorMessage: "PDF sans texte" };
  }

  // 3. LLM extraction
  let meta: Awaited<ReturnType<typeof extractInvoiceMetadata>>;
  try {
    meta = await extractInvoiceMetadata({
      emailSubject: msg.subject,
      emailFrom: msg.fromEmail,
      emailBody: msg.bodyText,
      pdfFilename: filing.originalFilename ?? "facture.pdf",
      pdfText,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await markError(filing.id, `extract metadata: ${errMsg}`);
    return { status: "error", errorMessage: errMsg };
  }

  if (!meta.isInvoice) {
    await markRejected(filing.id, "LLM a classé comme non-facture.");
    return { status: "rejected", errorMessage: "non-facture" };
  }
  if (!meta.invoiceDate || !meta.supplierName || !meta.prestationType) {
    await markRejected(
      filing.id,
      `champs manquants (date=${meta.invoiceDate}, supplier=${meta.supplierName}, prestation=${meta.prestationType})`,
    );
    return { status: "rejected", errorMessage: "champs manquants" };
  }

  // Sécurité : on n'auto-file que si confiance suffisante. Sinon on
  // garde en `pending` pour re-traitement / validation manuelle.
  if (meta.confidence < 0.6) {
    await conn
      .update(invoiceFilings)
      .set({
        invoiceDate: meta.invoiceDate,
        supplierRaw: meta.supplierName,
        supplierSanitized: sanitizeForFilename(meta.supplierName),
        prestationType: meta.prestationType,
        confidence: meta.confidence.toFixed(3),
        errorMessage: "confidence < 0.6 — validation manuelle requise",
      })
      .where(eq(invoiceFilings.id, filing.id));
    return { status: "rejected", errorMessage: "confidence faible" };
  }

  const invoiceDate = new Date(meta.invoiceDate);
  if (Number.isNaN(invoiceDate.getTime())) {
    await markRejected(filing.id, `date invalide: ${meta.invoiceDate}`);
    return { status: "rejected", errorMessage: "date invalide" };
  }

  // 4. Construit le filename selon la nomenclature.
  const filename = buildInvoiceFilename({
    invoiceDate,
    prestationType: meta.prestationType,
    supplierName: meta.supplierName,
  });
  const supplierSanitized = sanitizeForFilename(meta.supplierName);
  const year = String(invoiceDate.getFullYear());

  // 5. Crée la hiérarchie ROOT / <year> / <supplier> dans Drive.
  let yearFolderId: string;
  let supplierFolderId: string;
  let driveFileId: string;
  try {
    const yearFolder = await findOrCreateFolder(rootFolderId, year, accessToken);
    yearFolderId = yearFolder.id;
    const supplierFolder = await findOrCreateFolder(yearFolderId, supplierSanitized, accessToken);
    supplierFolderId = supplierFolder.id;

    // 6. Upload PDF avec le nouveau nom.
    const uploaded = await uploadFile({
      parentId: supplierFolderId,
      filename,
      mimeType: PDF_MIME,
      content: pdfBuffer,
      accessToken,
    });
    driveFileId = uploaded.id;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await markError(filing.id, `upload drive: ${errMsg}`);
    return { status: "error", errorMessage: errMsg };
  }

  // 7. Marque comme filé.
  await conn
    .update(invoiceFilings)
    .set({
      invoiceDate: meta.invoiceDate,
      supplierRaw: meta.supplierName,
      supplierSanitized,
      prestationType: meta.prestationType,
      confidence: meta.confidence.toFixed(3),
      generatedFilename: filename,
      driveYearFolderId: yearFolderId,
      driveSupplierFolderId: supplierFolderId,
      driveFileId,
      status: "filed",
      errorMessage: null,
    })
    .where(eq(invoiceFilings.id, filing.id));

  return { status: "filed", driveFileId, generatedFilename: filename };
}

async function markError(filingId: string, msg: string) {
  const conn = await db();
  await conn
    .update(invoiceFilings)
    .set({ status: "error", errorMessage: msg })
    .where(eq(invoiceFilings.id, filingId));
}

async function markRejected(filingId: string, msg: string) {
  const conn = await db();
  await conn
    .update(invoiceFilings)
    .set({ status: "rejected", errorMessage: msg })
    .where(eq(invoiceFilings.id, filingId));
}
