import "server-only";

/**
 * Dépose le PDF d'une facture de vente dans le Drive comptable.
 *
 * Les factures d'achat sont rangées depuis longtemps (`lib/gmail/invoice-filer.ts`) ;
 * les factures de vente ne vivaient que chez Dougs. Comme on télécharge déjà
 * leur PDF pour l'attacher au mail du client, le classement ne coûte qu'un
 * envoi de plus.
 *
 * Deux principes :
 *  - **idempotent** : `invoices.drive_file_id` non nul fait sortir tout de
 *    suite, donc un envoi rejoué ne crée pas de doublon dans le Drive ;
 *  - **non bloquant** : un échec de classement n'échoue jamais l'envoi. La
 *    facture est partie au client, c'est ce qui compte ; la copie se rattrape
 *    et la raison reste dans `drive_filing_error`.
 */

import { eq } from "drizzle-orm";
import { invoices } from "@/db/schema/invoices";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { uploadFile } from "@/lib/google/drive-api";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export type DriveFilingResult =
  | { filed: true; fileId: string; filename: string }
  | { filed: false; reason: "already_filed" | "not_configured" | "no_google_account" }
  | { filed: false; reason: "error"; message: string };

/**
 * Nom de fichier : la référence Dougs d'abord, parce qu'elle trie déjà
 * chronologiquement (`2026-10-FAC51`), puis le client pour qu'on reconnaisse la
 * facture d'un coup d'œil dans la liste.
 */
export function salesInvoiceFilename(reference: string, clientName: string): string {
  const safe = (v: string) =>
    v
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  const client = safe(clientName);
  return client ? `${safe(reference)}_${client}.pdf` : `${safe(reference)}.pdf`;
}

/** Dossier Drive cible, `null` si le réglage n'est pas posé. */
export async function getSalesInvoiceFolderId(): Promise<string | null> {
  return (await getSetting(SETTING_KEYS.SALES_INVOICE_DRIVE_FOLDER_ID))?.trim() || null;
}

export async function fileSalesInvoiceToDrive(args: {
  userId: string;
  invoiceId: string;
  reference: string;
  clientName: string;
  pdf: Buffer;
}): Promise<DriveFilingResult> {
  const conn = await db();

  const [row] = await conn
    .select({ driveFileId: invoices.driveFileId })
    .from(invoices)
    .where(eq(invoices.id, args.invoiceId))
    .limit(1);
  if (row?.driveFileId) return { filed: false, reason: "already_filed" };

  const folderId = await getSalesInvoiceFolderId();
  if (!folderId) return { filed: false, reason: "not_configured" };

  const accessToken = await getValidAccessToken(args.userId);
  if (!accessToken) return { filed: false, reason: "no_google_account" };

  const filename = salesInvoiceFilename(args.reference, args.clientName);
  try {
    const file = await uploadFile({
      parentId: folderId,
      filename,
      mimeType: "application/pdf",
      content: args.pdf,
      accessToken,
    });
    await conn
      .update(invoices)
      .set({
        driveFileId: file.id,
        driveFiledAt: new Date(),
        driveFilingError: null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, args.invoiceId));
    return { filed: true, fileId: file.id, filename };
  } catch (err) {
    const message = err instanceof Error ? err.message : "erreur inconnue";
    // Tracé, pas propagé : l'appelant vient d'envoyer la facture au client.
    await conn
      .update(invoices)
      .set({ driveFilingError: message, updatedAt: new Date() })
      .where(eq(invoices.id, args.invoiceId))
      .catch(() => undefined);
    console.warn(`[drive-filing] ${filename} non classée :`, message);
    return { filed: false, reason: "error", message };
  }
}
