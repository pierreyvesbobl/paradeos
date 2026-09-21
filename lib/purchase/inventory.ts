import "server-only";

import { invoiceFilings } from "@/db/schema/invoice-filings";
import { purchaseDocuments } from "@/db/schema/purchase-matching";
import { db } from "@/lib/db/server";
import { normalizeSupplierKey } from "@/lib/gmail/supplier-key";
import { getValidAccessToken } from "@/lib/google/account";
import { listFolderChildrenPaged } from "@/lib/google/drive-api";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { asc, inArray, sql } from "drizzle-orm";
import { parsePurchaseFilename } from "./filename";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

/**
 * Profondeur maximale explorée sous la racine. L'arborescence attendue est
 * `<ROOT>/<AAAA>/<Fournisseur>/` — soit 2 niveaux de dossiers. On en
 * autorise un de plus pour absorber les rangements manuels, et on
 * s'arrête là : au-delà, on descendrait dans des archives sans rapport.
 */
const MAX_DEPTH = 3;

export type InventorySyncResult = {
  scanned: number;
  /** Fichiers atteints par plus d'un chemin dans l'arborescence. */
  duplicatePaths: number;
  inserted: number;
  updated: number;
  /** Lignes supprimées parce que le fichier n'est plus dans le Drive. */
  pruned: number;
  folders: number;
  errors: string[];
};

type DiscoveredFile = {
  id: string;
  name: string;
  md5: string | null;
  size: number | null;
  createdAt: Date | null;
  webViewLink: string | null;
  /** Nom du dossier parent — fait autorité sur le fournisseur. */
  folderName: string | null;
};

/** Un dossier dont le nom est une année n'identifie aucun fournisseur. */
function isYearFolder(name: string): boolean {
  return /^(19|20)\d{2}$/.test(name.trim());
}

/**
 * Parcours récursif du dossier racine. Les raccourcis Drive sont ignorés :
 * ils pointent le plus souvent vers le même fichier déjà listé ailleurs,
 * et les suivre créerait des doublons d'inventaire.
 */
async function walkFolder(
  folderId: string,
  folderName: string | null,
  accessToken: string,
  depth: number,
  out: DiscoveredFile[],
  stats: { folders: number },
): Promise<void> {
  const children = await listFolderChildrenPaged(folderId, accessToken);
  stats.folders += 1;

  for (const child of children) {
    if (child.mimeType === SHORTCUT_MIME) continue;
    // Fichiers vides : Drive Desktop en sème (« facture 2.pdf », « 3.pdf »)
    // quand une synchro se chevauche. Ils n'ont rien à justifier et
    // coûteraient un appel LLM chacun.
    if (child.size !== undefined && Number(child.size) === 0) continue;

    if (child.mimeType === FOLDER_MIME) {
      if (depth >= MAX_DEPTH) continue;
      await walkFolder(child.id, child.name, accessToken, depth + 1, out, stats);
      continue;
    }

    out.push({
      id: child.id,
      name: child.name,
      md5: child.md5Checksum ?? null,
      size: child.size ? Number(child.size) : null,
      createdAt: child.createdTime ? new Date(child.createdTime) : null,
      webViewLink: child.webViewLink ?? null,
      folderName: folderName,
    });
  }
}

/**
 * Choisit le compte au nom duquel lire le Drive comptable.
 *
 * Le dossier est unique pour l'entreprise : le scanner une fois par
 * associé relirait — et repaierait au LLM — les mêmes milliers de pages.
 * On retient donc celui qui classe déjà les factures reçues par mail :
 * c'est lui qui alimente le dossier, et ses `invoice_filings` portent les
 * montants déjà extraits, qui évitent autant d'appels au modèle.
 *
 * À défaut (aucun classement encore), le premier candidat par ordre
 * stable — pour que deux runs successifs prennent le même.
 */
export async function pickInventoryOwner(candidateUserIds: string[]): Promise<string | null> {
  const sorted = [...candidateUserIds].sort();
  const fallback = sorted[0] ?? null;
  if (sorted.length <= 1) return fallback;

  const conn = await db();
  const [top] = await conn
    .select({
      userId: invoiceFilings.userId,
      filings: sql<number>`count(*)::int`,
    })
    .from(invoiceFilings)
    .where(inArray(invoiceFilings.userId, sorted))
    .groupBy(invoiceFilings.userId)
    .orderBy(sql`count(*) desc`, asc(invoiceFilings.userId))
    .limit(1);

  return top?.userId ?? fallback;
}

/**
 * Inventorie le dossier Drive des factures d'achat.
 *
 * Miroir du dossier et non de la boîte mail : on ramasse aussi les
 * fichiers déposés par l'ancienne chaîne de classement, qui n'ont pas de
 * ligne dans `invoice_filings`. Le scope `drive.readonly` le permet — on
 * lit seulement, jamais on ne déplace ni ne supprime.
 *
 * Idempotent : l'identité d'un document est son `drive_file_id`. Un
 * second passage met à jour les métadonnées Drive sans toucher aux
 * montants déjà extraits.
 */
export async function syncPurchaseInventory(userId: string): Promise<InventorySyncResult> {
  const result: InventorySyncResult = {
    scanned: 0,
    duplicatePaths: 0,
    inserted: 0,
    updated: 0,
    pruned: 0,
    folders: 0,
    errors: [],
  };

  const rootFolderId = await getSetting(SETTING_KEYS.INVOICE_FILING_ROOT_FOLDER_ID);
  if (!rootFolderId) {
    result.errors.push("Dossier racine des factures non configuré (/settings/integrations).");
    return result;
  }

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    result.errors.push("Pas d'access token Google pour cet utilisateur.");
    return result;
  }

  const files: DiscoveredFile[] = [];
  const walkStats = { folders: 0 };
  try {
    await walkFolder(rootFolderId, null, accessToken, 0, files, walkStats);
  } catch (err) {
    result.errors.push(`scan Drive : ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  // Un même fichier peut être atteint par deux chemins (raccourci résolu,
  // fichier rangé dans deux dossiers — Drive l'autorise). L'inventaire
  // raisonne par identité de fichier, pas par chemin.
  const unique = new Map<string, DiscoveredFile>();
  for (const file of files) {
    if (!unique.has(file.id)) unique.set(file.id, file);
  }
  const uniqueFiles = [...unique.values()];

  result.scanned = uniqueFiles.length;
  result.duplicatePaths = files.length - uniqueFiles.length;
  result.folders = walkStats.folders;
  if (uniqueFiles.length === 0) return result;

  const conn = await db();

  // Ce que la chaîne Gmail connaît déjà de ces fichiers : fournisseur,
  // date et montants y sont plus fiables que ce qu'on devine d'un nom.
  const filings = await conn
    .select({
      id: invoiceFilings.id,
      driveFileId: invoiceFilings.driveFileId,
      supplierRaw: invoiceFilings.supplierRaw,
      supplierSanitized: invoiceFilings.supplierSanitized,
      invoiceDate: invoiceFilings.invoiceDate,
      amountTtc: invoiceFilings.amountTtc,
      amountHt: invoiceFilings.amountHt,
      vatAmount: invoiceFilings.vatAmount,
      currency: invoiceFilings.currency,
      invoiceNumber: invoiceFilings.invoiceNumber,
    })
    .from(invoiceFilings)
    .where(
      inArray(
        invoiceFilings.driveFileId,
        uniqueFiles.map((f) => f.id),
      ),
    );
  const filingByDriveId = new Map(filings.map((f) => [f.driveFileId ?? "", f]));

  // Pas de filtre sur `user_id` : l'inventaire décrit UN dossier
  // d'entreprise, et `drive_file_id` y est unique globalement. La colonne
  // `user_id` dit au nom de quel compte le Drive a été lu, elle ne
  // partitionne pas les données. Filtrer dessus ferait manquer les lignes
  // écrites par un run précédent sous un autre compte — qui échapperaient
  // alors à l'élagage.
  const known = await conn
    .select({
      id: purchaseDocuments.id,
      driveFileId: purchaseDocuments.driveFileId,
    })
    .from(purchaseDocuments);
  const knownIds = new Set(known.map((k) => k.driveFileId));

  for (const file of uniqueFiles) {
    const filing = filingByDriveId.get(file.id);
    const parsed = parsePurchaseFilename(file.name);

    // Le dossier fait autorité sur le nom de fichier : il est stable, alors
    // qu'un nom de fichier peut avoir été bricolé à la main.
    const supplierLabel =
      filing?.supplierRaw ??
      (file.folderName && !isYearFolder(file.folderName) ? file.folderName : null) ??
      parsed.supplierLabel;

    const invoiceDate =
      filing?.invoiceDate ??
      (parsed.invoiceDate ? parsed.invoiceDate.toISOString().slice(0, 10) : null);

    const row = {
      userId,
      driveFileId: file.id,
      driveFileName: file.name,
      driveMd5: file.md5,
      sizeBytes: file.size,
      driveCreatedAt: file.createdAt,
      webViewLink: file.webViewLink,
      supplierLabel,
      supplierKey: supplierLabel ? normalizeSupplierKey(supplierLabel) : null,
      invoiceDate,
      source: filing ? ("parade_os" as const) : ("legacy" as const),
      invoiceFilingId: filing?.id ?? null,
      // Les montants de la chaîne Gmail évitent un aller-retour LLM. Sans
      // eux, le document part dans la file de backfill.
      amountTtc: filing?.amountTtc ?? null,
      amountHt: filing?.amountHt ?? null,
      vatAmount: filing?.vatAmount ?? null,
      currency: filing?.currency ?? null,
      invoiceNumber: filing?.invoiceNumber ?? null,
      extractionStatus: filing?.amountTtc ? ("done" as const) : ("pending" as const),
    };

    try {
      await conn
        .insert(purchaseDocuments)
        .values(row)
        .onConflictDoUpdate({
          target: purchaseDocuments.driveFileId,
          set: {
            driveFileName: row.driveFileName,
            driveMd5: row.driveMd5,
            sizeBytes: row.sizeBytes,
            driveCreatedAt: row.driveCreatedAt,
            webViewLink: row.webViewLink,
            supplierLabel: row.supplierLabel,
            supplierKey: row.supplierKey,
            invoiceDate: row.invoiceDate,
            // Le propriétaire converge vers le compte choisi pour lire le
            // Drive : sans ça, une ligne écrite par un ancien run resterait
            // rattachée à un autre associé.
            userId: row.userId,
            source: row.source,
            invoiceFilingId: row.invoiceFilingId,
            // Les montants ne sont réécrits que si la chaîne Gmail en a
            // trouvé : un re-scan ne doit jamais effacer ce que le
            // backfill a déjà extrait.
            ...(row.amountTtc
              ? {
                  amountTtc: row.amountTtc,
                  amountHt: row.amountHt,
                  vatAmount: row.vatAmount,
                  currency: row.currency,
                  invoiceNumber: row.invoiceNumber,
                  extractionStatus: "done" as const,
                }
              : {}),
            updatedAt: new Date(),
          },
        });
      if (knownIds.has(file.id)) result.updated += 1;
      else result.inserted += 1;
    } catch (err) {
      result.errors.push(`${file.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Élagage : un document retiré du Drive (ou un fichier vide qu'on ne
  // ramasse plus) ne doit pas rester dans l'inventaire, sinon il occupe
  // la file d'extraction pour toujours et pollue les rapprochements.
  //
  // Uniquement si le scan s'est déroulé entièrement : sur un scan
  // partiel, l'absence d'un fichier ne prouve rien — on préfère garder
  // une ligne périmée qu'effacer un inventaire par accident.
  if (result.errors.length === 0) {
    const seen = new Set(uniqueFiles.map((f) => f.id));
    const stale = known.filter((k) => !seen.has(k.driveFileId)).map((k) => k.id);
    if (stale.length > 0) {
      await conn.delete(purchaseDocuments).where(inArray(purchaseDocuments.id, stale));
      result.pruned = stale.length;
    }
  }

  return result;
}
