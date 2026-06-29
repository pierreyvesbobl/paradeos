import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match toutes les routes sauf :
     * - _next/static, _next/image, favicon.ico
     * - icon / apple-icon (convention App Router — pas d'extension dans l'URL)
     * - fichiers statiques avec extension (png, svg, jpg, ico, css, js)
     */
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js)$).*)",
  ],
};
