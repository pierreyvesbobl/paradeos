import "server-only";

/**
 * Wrappers fins autour de l'API Google Drive v3 — fetch direct, sans
 * `googleapis` (lourd, et 90 % du SDK ne sert pas ici).
 *
 * Tous les helpers attendent un `accessToken` valide (cf. `getValidAccessToken`).
 * Avec le scope `drive.file`, on n'accède qu'aux fichiers/dossiers que
 * l'utilisateur a explicitement choisis via le Picker (et leurs
 * descendants), ou créés par l'app.
 */

const API_BASE = "https://www.googleapis.com/drive/v3";

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
};

async function driveFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status} : ${text}`);
  }
  return (await res.json()) as T;
}

export async function getFolderMetadata(folderId: string, accessToken: string): Promise<DriveFile> {
  return driveFetch<DriveFile>(
    `/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,webViewLink,iconLink,parents`,
    accessToken,
  );
}

export async function listFolderChildren(
  folderId: string,
  accessToken: string,
  limit = 100,
): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent(
    "files(id,name,mimeType,iconLink,webViewLink,modifiedTime,size)",
  );
  const data = await driveFetch<{ files?: DriveFile[] }>(
    `/files?q=${q}&fields=${fields}&orderBy=folder,modifiedTime desc&pageSize=${limit}`,
    accessToken,
  );
  return data.files ?? [];
}

export async function createDriveFolder(
  name: string,
  accessToken: string,
  parentId = "root",
): Promise<DriveFile> {
  return driveFetch<DriveFile>("/files?fields=id,name,mimeType,webViewLink,iconLink", accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    }),
  });
}

export type ResolvedFolderPath = {
  /** Chemin lisible affiché à l'user. */
  displayPath: string;
  /** Chemin tel qu'utilisable sous `~/Library/CloudStorage/GoogleDrive-<email>/`. */
  localPath: string;
};

async function findShortcutToFolder(
  targetId: string,
  accessToken: string,
): Promise<{ id: string; name: string } | null> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.shortcut' and shortcutDetails.targetId='${targetId}' and trashed=false`,
  );
  const fields = encodeURIComponent("files(id,name)");
  try {
    const data = await driveFetch<{ files?: Array<{ id: string; name: string }> }>(
      `/files?q=${q}&fields=${fields}&pageSize=1`,
      accessToken,
    );
    const f = data.files?.[0];
    return f ? { id: f.id, name: f.name } : null;
  } catch {
    return null;
  }
}

/**
 * Reconstruit le chemin d'un dossier (lisible + Drive Desktop) en
 * remontant les parents. Trois cas gérés :
 *
 *  1. Dossier dans My Drive → `My Drive/Foo/Bar`
 *  2. Dossier accédé via un raccourci dans My Drive (cas typique :
 *     équipe partagée) → `.shortcut-targets-by-id/<shortcut-id>/<name>/Foo/Bar`
 *     (Drive Desktop préfixe par l'id du raccourci + le nom du target)
 *  3. Sinon → null (Shared Drive sans raccourci ou autre cas non géré)
 */
export async function resolveFolderPath(
  folderId: string,
  accessToken: string,
): Promise<ResolvedFolderPath | null> {
  // 1. Récupère l'id de la racine My Drive de l'user
  let rootId: string | null = null;
  try {
    const root: DriveFile = await driveFetch("/files/root?fields=id", accessToken);
    rootId = root.id;
  } catch {
    // Sans drive.readonly on ne peut pas atteindre 'root' — tant pis,
    // on continue avec rootId null (le case My Drive ne sera jamais
    // détecté, on tombera sur le case raccourci si applicable).
  }

  const ancestors: Array<{ id: string; name: string }> = [];
  let currentId: string | undefined = folderId;

  for (let i = 0; i < 15 && currentId; i++) {
    let meta: DriveFile;
    try {
      meta = await driveFetch(
        `/files/${encodeURIComponent(currentId)}?fields=id,name,parents`,
        accessToken,
      );
    } catch {
      break;
    }
    ancestors.unshift({ id: meta.id, name: meta.name });

    if (!meta.parents || meta.parents.length === 0) {
      break;
    }

    const parentId = meta.parents[0];
    if (!parentId) break;

    // Cas 1 : parent = racine My Drive → on a un chemin My Drive complet
    if (rootId && parentId === rootId) {
      const inner = ancestors.map((a) => a.name).join("/");
      const myDrivePath = `My Drive/${inner}`;
      return { displayPath: myDrivePath, localPath: myDrivePath };
    }

    // Cas 2 : parent est la cible d'un raccourci dans le Drive de l'user
    const shortcut = await findShortcutToFolder(parentId, accessToken);
    if (shortcut) {
      const inner = ancestors.map((a) => a.name).join("/");
      // Drive Desktop matérialise le raccourci sous
      // `.shortcut-targets-by-id/<TARGET-id>/<shortcut-name>/<...>`
      // — c'est l'ID DU DOSSIER CIBLE (notre `parentId`) qui apparaît
      // dans le chemin, pas celui du fichier raccourci.
      return {
        displayPath: `Raccourci → ${shortcut.name}/${inner}`,
        localPath: `.shortcut-targets-by-id/${parentId}/${shortcut.name}/${inner}`,
      };
    }

    currentId = parentId;
  }

  // Cas 3 : on n'a pas pu déterminer (Shared Drive sans raccourci…)
  return null;
}

export type { DriveFile };
