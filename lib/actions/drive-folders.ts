"use server";

import { driveFolders } from "@/db/schema/drive-folders";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { getGoogleAccount, getValidAccessToken } from "@/lib/google/account";
import { createDriveFolder, resolveFolderPath } from "@/lib/google/drive-api";
import type { DriveFileSubjectType } from "@/lib/schemas/drive-files";
import {
  createDriveFolderSchema,
  linkDriveFolderSchema,
  unlinkDriveFolderSchema,
} from "@/lib/schemas/drive-folders";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const SUBJECT_REVALIDATE_PATH: Record<DriveFileSubjectType, (id: string) => string | null> = {
  project: (id) => `/projets/${id}`,
  entity: (id) => `/entites/${id}`,
  contact: (id) => `/contacts/${id}`,
  note: () => null,
  meeting: () => null,
};

function revalidateSubject(subjectType: DriveFileSubjectType, subjectId: string) {
  const path = SUBJECT_REVALIDATE_PATH[subjectType]?.(subjectId);
  if (path) revalidatePath(path);
}

/**
 * Lie un dossier Drive existant (choisi via Picker) au sujet. Récupère
 * en arrière-plan le chemin canonique (`My Drive/…`) pour permettre
 * "ouvrir en local".
 */
export const linkDriveFolder = action(linkDriveFolderSchema, async ({ input, user }) => {
  const account = await getGoogleAccount(user.id);
  if (!account) throw new Error("Google Drive non connecté.");

  let folderPath: string | null = null;
  let folderLocalPath: string | null = null;
  try {
    const accessToken = await getValidAccessToken(user.id);
    if (accessToken) {
      const resolved = await resolveFolderPath(input.folderId, accessToken);
      if (resolved) {
        folderPath = resolved.displayPath;
        folderLocalPath = resolved.localPath;
      }
    }
  } catch (err) {
    console.warn("[drive-folders] resolve path failed", err);
  }

  const conn = await db();
  await conn
    .insert(driveFolders)
    .values({
      googleAccountId: account.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      folderId: input.folderId,
      folderName: input.folderName,
      folderUrl: input.folderUrl ?? null,
      folderPath,
      folderLocalPath,
      addedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [driveFolders.subjectType, driveFolders.subjectId],
      set: {
        googleAccountId: account.id,
        folderId: input.folderId,
        folderName: input.folderName,
        folderUrl: input.folderUrl ?? null,
        folderPath,
        folderLocalPath,
        addedBy: user.id,
        updatedAt: new Date(),
      },
    });

  revalidateSubject(input.subjectType, input.subjectId);
  return { folderId: input.folderId };
});

/**
 * Crée un dossier dans le Drive de l'utilisateur (à la racine de
 * "My Drive") puis le lie au sujet.
 */
export const createAndLinkDriveFolder = action(createDriveFolderSchema, async ({ input, user }) => {
  const account = await getGoogleAccount(user.id);
  if (!account) throw new Error("Google Drive non connecté.");
  const accessToken = await getValidAccessToken(user.id);
  if (!accessToken) throw new Error("Token Google invalide — reconnecte-toi.");

  const folder = await createDriveFolder(input.name, accessToken);
  // Création à la racine de My Drive → display = local = "My Drive/<nom>"
  const folderPath = `My Drive/${folder.name}`;
  const folderLocalPath = folderPath;
  const folderUrl = folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`;

  const conn = await db();
  await conn
    .insert(driveFolders)
    .values({
      googleAccountId: account.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      folderId: folder.id,
      folderName: folder.name,
      folderUrl,
      folderPath,
      folderLocalPath,
      addedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [driveFolders.subjectType, driveFolders.subjectId],
      set: {
        googleAccountId: account.id,
        folderId: folder.id,
        folderName: folder.name,
        folderUrl,
        folderPath,
        folderLocalPath,
        addedBy: user.id,
        updatedAt: new Date(),
      },
    });

  revalidateSubject(input.subjectType, input.subjectId);
  return { folderId: folder.id, folderName: folder.name, folderUrl };
});

export const unlinkDriveFolder = action(unlinkDriveFolderSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .delete(driveFolders)
    .where(
      and(
        eq(driveFolders.subjectType, input.subjectType),
        eq(driveFolders.subjectId, input.subjectId),
      ),
    );
  revalidateSubject(input.subjectType, input.subjectId);
  return { ok: true };
});
