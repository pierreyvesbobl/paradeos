import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth/server";
import { buildAuthorizeUrl } from "@/lib/google/oauth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const STATE_COOKIE = "g_oauth_state";

/**
 * Démarre le flow OAuth Google. Génère un `state` random, le pose en
 * cookie httpOnly courte durée, puis redirige l'user vers le consent
 * screen Google. Le `state` sera vérifié côté callback pour bloquer
 * les CSRF.
 */
export async function GET() {
  await requireUser();

  const state = randomBytes(32).toString("base64url");
  const url = buildAuthorizeUrl({ state });

  const c = await cookies();
  c.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(url);
}
