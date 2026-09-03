import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// `/api/dougs/sync-cookie` est appelé par l'extension Chrome
// "Paradeos Dougs Sync" depuis l'origine app.dougs.fr — pas de session
// Supabase, auth via Bearer token (cf. resolveSyncToken).
// `/api/mcp` est appelé par les clients MCP (Claude Desktop/Code, Cursor…)
// en transport HTTP — pas de cookie de session, auth via
// `Authorization: Bearer paradeos_pat_…` ou un access token OAuth
// (cf. resolveMcpAuth dans la route).
// `/.well-known` et `/api/oauth` sont les endpoints de découverte et
// d'échange OAuth : ils DOIVENT rester accessibles sans session, c'est
// tout l'intérêt — un client anonyme y découvre comment s'authentifier.
// `/oauth/authorize` est volontairement absent : c'est la page de
// consentement, elle exige une session (le middleware redirige vers
// /login en conservant les paramètres OAuth).
const PUBLIC_ROUTES = [
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/api/cron",
  "/api/dougs/sync-cookie",
  "/api/mcp",
  "/api/oauth",
  "/.well-known",
];

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis.");
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Doit rester juste après createServerClient — sinon la session ne se rafraîchit pas.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    // `search` inclus : sans lui, un /oauth/authorize?client_id=…&state=…
    // revient après login amputé de tous ses paramètres, et le flow OAuth
    // ne peut plus reprendre.
    const target = `${pathname}${request.nextUrl.search}`;
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", target);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    // Un user déjà connecté qui arrive sur /login?next=… doit repartir
    // vers sa destination (typiquement /oauth/authorize), pas vers "/".
    // `next` n'est suivi que s'il est relatif à cette origine : un "//evil"
    // ou une URL absolue serait une redirection ouverte.
    const next = request.nextUrl.searchParams.get("next");
    const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
    if (safeNext) {
      const target = new URL(safeNext, request.nextUrl.origin);
      redirectUrl.pathname = target.pathname;
      redirectUrl.search = target.search;
    } else {
      redirectUrl.pathname = "/";
      redirectUrl.search = "";
    }
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
