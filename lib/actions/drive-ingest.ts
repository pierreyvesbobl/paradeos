"use server";

import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { ingestDriveTranscripts } from "@/lib/meetings/ingest-from-drive";
import { parseDriveFolderId, updateMeetingsDriveFolderSchema } from "@/lib/schemas/drive-ingest";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const updateMeetingsDriveFolder = action(
  updateMeetingsDriveFolderSchema,
  async ({ input, user }) => {
    await requireAdmin(user);
    if (input.folder === "") {
      await setSetting(SETTING_KEYS.MEETINGS_DRIVE_FOLDER_ID, null, user.id);
    } else {
      const folderId = parseDriveFolderId(input.folder);
      if (!folderId) throw new Error("ID de dossier invalide.");
      await setSetting(SETTING_KEYS.MEETINGS_DRIVE_FOLDER_ID, folderId, user.id);
    }
    revalidatePath("/settings/integrations");
    return { ok: true as const };
  },
);

/**
 * Déclenche manuellement la sync Drive depuis l'UI (bouton « Sync now »).
 * Le cron 30 min fait le même boulot en automatique.
 */
export const syncDriveTranscriptsNow = action(z.object({}), async ({ user }) => {
  await requireAdmin(user);
  const result = await ingestDriveTranscripts();
  revalidatePath("/meetings");
  revalidatePath("/settings/integrations");
  return result;
});
