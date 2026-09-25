import "server-only";

import { noteAttachments } from "@/db/schema/note-attachments";
import { db } from "@/lib/db/server";
import { createClient } from "@supabase/supabase-js";
import { inArray } from "drizzle-orm";

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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      console.error("[notes] pièces jointes non purgées : credentials Supabase admin absents.");
      return;
    }
    const sb = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await sb.storage.from(BUCKET).remove(rows.map((r) => r.storagePath));
    if (error) console.error("[notes] storage remove error:", error);
  } catch (err) {
    console.error("[notes] purge des pièces jointes échouée:", err);
  }
}
