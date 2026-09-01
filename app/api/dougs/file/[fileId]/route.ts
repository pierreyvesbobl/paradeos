/**
 * Proxy de téléchargement des justificatifs Dougs.
 *
 * On ne peut pas pointer un `<a href>` directement sur Dougs : le
 * navigateur de l'utilisateur n'a pas forcément de session Dougs
 * ouverte, et notre cookie est chiffré côté serveur. On relaie donc le
 * fichier, en s'appuyant sur `downloadDougsFile` qui suit la
 * redirection S3 sans jamais réémettre le cookie hors de app.dougs.fr.
 *
 * Auth : session Paradeos. Le fileId est passé tel quel à Dougs, qui
 * fait sa propre autorisation — un id d'une autre société renvoie 403.
 */
import { requireUser } from "@/lib/auth/server";
import { DougsApiError, DougsAuthError, downloadDougsFile } from "@/lib/dougs/client";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await requireUser();
  const { fileId } = await params;

  try {
    const file = await downloadDougsFile(user.id, fileId);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.buffer.byteLength),
        // `inline` : les PDF s'ouvrent dans l'onglet plutôt que de
        // tomber dans les téléchargements. Le nom reste celui de Dougs.
        "Content-Disposition": `inline; filename="${(file.filename ?? fileId).replace(/"/g, "")}"`,
        // Justificatif comptable : jamais de cache partagé.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof DougsAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof DougsApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[dougs] téléchargement justificatif", err);
    return NextResponse.json({ error: "Téléchargement Dougs impossible." }, { status: 502 });
  }
}
