"use server";

import { noteAttachments } from "@/db/schema/note-attachments";
import { notes } from "@/db/schema/notes";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  attachToNoteSchema,
  deleteAttachmentSchema,
  signedUrlSchema,
} from "@/lib/schemas/note-attachments";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const BUCKET = "note-attachments";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin credentials missing.");
  }
  return createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Enregistre la métadonnée d'une pièce jointe après upload côté client.
 * Le client a déjà fait l'upload via signed URL POST (cf. signedUploadUrl).
 */
export const attachToNote = action(attachToNoteSchema, async ({ input, user }) => {
  const conn = await db();

  // Vérifie que la note existe.
  const [note] = await conn
    .select({ id: notes.id, subjectType: notes.subjectType, subjectId: notes.subjectId })
    .from(notes)
    .where(eq(notes.id, input.noteId))
    .limit(1);

  if (!note) throw new Error("Note introuvable.");

  // Le chemin doit être celui minté par `signedUploadUrl` pour CETTE note.
  // Sans ce contrôle, on pourrait enregistrer un pointeur vers le fichier
  // d'une autre note puis le lire « légitimement » via l'UI.
  if (!isPathOfNote(input.storagePath, input.noteId)) {
    throw new Error("Chemin de fichier invalide pour cette note.");
  }

  await conn.insert(noteAttachments).values({
    noteId: input.noteId,
    storagePath: input.storagePath,
    fileName: input.fileName,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    uploadedBy: user.id,
  });

  if (note.subjectType && note.subjectId) {
    revalidatePath(subjectPath(note.subjectType, note.subjectId));
  }
  revalidatePath("/notes");

  return { ok: true as const };
});

/**
 * Génère une URL signée pour upload côté client (POST direct vers Storage).
 */
export const signedUploadUrl = action(signedUrlSchema, async ({ input }) => {
  const sb = admin();
  const path = `${input.noteId}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Création URL upload : ${error.message}`);
  if (!data) throw new Error("URL upload non retournée.");

  return {
    path,
    signedUrl: data.signedUrl,
    token: data.token,
  };
});

/** Supprime une pièce jointe (DB + Storage). */
export const deleteAttachment = action(deleteAttachmentSchema, async ({ input }) => {
  const conn = await db();
  const [att] = await conn
    .select({
      id: noteAttachments.id,
      storagePath: noteAttachments.storagePath,
      noteId: noteAttachments.noteId,
    })
    .from(noteAttachments)
    .where(eq(noteAttachments.id, input.id))
    .limit(1);

  if (!att) throw new Error("Pièce jointe introuvable.");

  const sb = admin();
  const { error } = await sb.storage.from(BUCKET).remove([att.storagePath]);
  if (error) console.error("[note-attachments] storage remove error:", error);

  await conn.delete(noteAttachments).where(eq(noteAttachments.id, input.id));

  // Revalide tous les paths possibles (on n'a pas le sujet ici sans 1 query de plus).
  revalidatePath("/notes");
  return { ok: true as const };
});

/** `<note_id>/<uuid>-<fichier>` sans segment `..` ni chemin absolu. */
function isPathOfNote(storagePath: string, noteId: string): boolean {
  if (!storagePath.startsWith(`${noteId}/`)) return false;
  const rest = storagePath.slice(noteId.length + 1);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("..");
}

function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 200);
}

function subjectPath(type: string, id: string): string {
  switch (type) {
    case "entity":
      return `/entites/${id}`;
    case "contact":
      return `/contacts/${id}`;
    case "opportunity":
      return `/opportunites/${id}`;
    case "project":
      return `/projets/${id}`;
    case "task":
      return `/taches/${id}`;
    default:
      return "/notes";
  }
}
