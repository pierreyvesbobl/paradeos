import { z } from "zod";

/**
 * Accepte soit un ID de dossier brut (`1ehwreM27Jr9dVXdoSrJBMmkXgC4834ij`),
 * soit une URL complète Drive (`https://drive.google.com/drive/folders/<id>`).
 * Empty string = supprimer le réglage.
 */
export const updateMeetingsDriveFolderSchema = z.object({
  folder: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => v === "" || /^[a-zA-Z0-9_-]+$/.test(v) || /\/folders\/[a-zA-Z0-9_-]+/.test(v),
      "ID de dossier invalide ou URL Drive non reconnue.",
    ),
});

/**
 * Extrait l'ID d'un dossier Drive depuis un input qui peut être l'ID
 * direct ou une URL Google Drive.
 */
export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m?.[1]) return m[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}
