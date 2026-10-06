import "server-only";

import { inArray } from "drizzle-orm";
import { noteAttachments } from "@/db/schema/note-attachments";
import { db } from "@/lib/db/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

const BUCKET = "note-attachments";

/**
 * Retire du bucket les fichiers des notes données. À appeler **avant** le
 * DELETE : les lignes `note_attachments` partent en cascade et on perdrait
 * les chemins Storage, laissant les binaires orphelins dans le bucket.
 *
 * Best-effort : une erreur Storage est loguée mais n'empêche pas la
 * suppression de la note. Un fichier orphelin est moins grave qu'une note
 * que l'utilisateur croit supprimée et qui réapparaît.
 */
export async function removeNoteAttachmentObjects(noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;
  try {
    const conn = await db();
    const rows = await conn
      .select({ storagePath: noteAttachments.storagePath })
      .from(noteAttachments)
      .where(inArray(noteAttachments.noteId, noteIds));
    if (rows.length === 0) return;

    const sb = tryCreateAdminClient();
    if (!sb) {
      console.error("[notes] pièces jointes non purgées : credentials Supabase admin absents.");
      return;
    }
    const { error } = await sb.storage.from(BUCKET).remove(rows.map((r) => r.storagePath));
    if (error) console.error("[notes] storage remove error:", error);
  } catch (err) {
    console.error("[notes] purge des pièces jointes échouée:", err);
  }
}
