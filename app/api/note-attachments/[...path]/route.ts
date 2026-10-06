import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { noteAttachments } from "@/db/schema/note-attachments";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * Sert une pièce jointe de note : redirige (302) vers une URL signée
 * Storage valable 5 minutes. Utilisé par les images inline de l'éditeur
 * de notes (`attachment://<path>` réécrit en `/api/note-attachments/<path>`).
 *
 * Sécurité : le bucket est privé et on signe avec la clé service, qui
 * ignore les policies Storage. On ne signe donc JAMAIS un chemin fourni
 * par le client tel quel : il doit correspondre à une pièce jointe
 * enregistrée dans `note_attachments` (cf. `attachToNote`, qui impose le
 * préfixe `<note_id>/`). Les notes sont partagées entre membres de
 * l'équipe : tout utilisateur authentifié peut lire toute pièce jointe
 * enregistrée, mais rien d'autre dans le bucket.
 */
const BUCKET = "note-attachments";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  await requireUser();

  const { path } = await context.params;
  const storagePath = path.map(decodeURIComponent).join("/");

  const conn = await db();
  const [attachment] = await conn
    .select({ storagePath: noteAttachments.storagePath })
    .from(noteAttachments)
    .where(eq(noteAttachments.storagePath, storagePath))
    .limit(1);
  if (!attachment) {
    return new NextResponse("Not found", { status: 404 });
  }

  const sb = tryCreateAdminClient();
  if (!sb) return new NextResponse("Storage not configured", { status: 500 });

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(attachment.storagePath, 300);
  if (error || !data) {
    return new NextResponse(error?.message ?? "Not found", { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
