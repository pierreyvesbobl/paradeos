/**
 * Où Meet range ses transcripts, et comment on les retrouve.
 *
 * Jusqu'à l'été 2026, Meet déposait tout à plat dans « Meet Recordings » :
 * lister le dossier suffisait. Depuis la mi-septembre 2026, il crée un
 * dossier « Google Meet », y range l'ancien « Meet Recordings », et ouvre
 * un sous-dossier par réunion à côté :
 *
 *   Google Meet/
 *     Meet Recordings/                          ← l'ancien stock, à plat
 *     Point Channel Health - 2026/10/09 16:56 CEST/
 *       Point Channel Health - 2026/10/09 16:56 CEST - Transcript
 *     [IMPORTANT] Point Parade (recurring)/
 *       [IMPORTANT] Point Parade - 2026/10/19 14:16 CEST - Notes par Gemini
 *
 * Un listing à plat du dossier configuré ne voit donc plus rien de neuf.
 * On descend d'un niveau : le dossier, puis ses sous-dossiers les plus
 * récents. Un seul niveau, parce que c'est ce que Meet produit et que
 * chaque sous-dossier coûte un appel Drive.
 *
 * Ce module est pur : la lecture du Drive lui est injectée, ce qui le
 * rend testable sans jeton.
 */

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/** Le strict nécessaire pour décider si on descend et quoi remonter. */
export type WalkableDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

/**
 * Sous-dossiers explorés par run, les plus récents d'abord. « Google
 * Meet » gagne un dossier par réunion ; au-delà de quelques dizaines,
 * les plus anciens sont tous déjà en base et ne méritent plus un appel
 * à chaque quart d'heure.
 */
export const MAX_SUBFOLDERS_PER_RUN = 30;

/** Fichiers lus dans chaque sous-dossier : Meet y met deux ou trois pièces. */
const SUBFOLDER_PAGE_SIZE = 20;

export type ListChildren<F extends WalkableDriveFile> = (
  folderId: string,
  limit: number,
) => Promise<F[]>;

export type DriveWalkResult<F extends WalkableDriveFile> = {
  /** Fichiers (jamais de dossiers) trouvés à la racine et un niveau en dessous. */
  files: F[];
  /** Sous-dossiers dont le listing a échoué, pour le bilan du run. */
  errors: { folder: F; error: Error }[];
};

/**
 * Rend les fichiers du dossier et de ses sous-dossiers directs, les plus
 * récents d'abord à chaque niveau. Un sous-dossier illisible n'arrête
 * pas la tournée : il est consigné et on passe au suivant.
 */
export async function walkTranscriptFolder<F extends WalkableDriveFile>(
  folderId: string,
  listChildren: ListChildren<F>,
  { rootPageSize = 100, maxSubfolders = MAX_SUBFOLDERS_PER_RUN } = {},
): Promise<DriveWalkResult<F>> {
  const root = await listChildren(folderId, rootPageSize);
  const files: F[] = [];
  const subfolders: F[] = [];
  for (const entry of root) {
    if (entry.mimeType === DRIVE_FOLDER_MIME) subfolders.push(entry);
    else files.push(entry);
  }

  // Drive ne garantit l'ordre que sur ce qu'on lui demande ; on retrie
  // ici pour que le plafond coupe bien les plus anciens.
  subfolders.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));

  const errors: DriveWalkResult<F>["errors"] = [];
  for (const folder of subfolders.slice(0, maxSubfolders)) {
    try {
      const children = await listChildren(folder.id, SUBFOLDER_PAGE_SIZE);
      for (const child of children) {
        if (child.mimeType !== DRIVE_FOLDER_MIME) files.push(child);
      }
    } catch (err) {
      errors.push({ folder, error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  return { files, errors };
}
