import { requireUser } from "@/lib/auth/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Sert une pièce jointe de note (image, fichier) en générant une URL
 * signée fraîche puis en redirigeant. Auth-gated : seul un user
 * authentifié peut accéder.
 *
 * Le markdown des notes utilise un pseudo-protocole `attachment://path`
 * que le composant `<Markdown>` réécrit en `/api/note-attachments/path`.
 * Cette URL est stable côté markdown (pas de signed URL qui expire) et
 * sécurisée par cookie de session.
 */
const BUCKET = "note-attachments";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  await requireUser();

  const { path } = await context.params;
  const storagePath = path.map(decodeURIComponent).join("/");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return new NextResponse("Storage not configured", { status: 500 });
  }
  const sb = createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data) {
    return new NextResponse(error?.message ?? "Not found", { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
