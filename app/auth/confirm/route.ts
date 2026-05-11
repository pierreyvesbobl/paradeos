import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Confirme un OTP / magic link / recovery côté serveur. Gère les deux
 * flows possibles selon la config Supabase :
 *
 * 1. **PKCE** : URL `?code=<pkce>` → `exchangeCodeForSession`. C'est le
 *    flow par défaut sur les templates Supabase modernes (incluant les
 *    liens de reset password).
 * 2. **Token-hash** : URL `?token_hash=<hash>&type=<type>` → `verifyOtp`.
 *    Ancien flow / template custom utilisant `{{ .TokenHash }}`.
 *
 * Dans les deux cas on redirige vers `next` une fois la session établie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
      );
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
      );
    }
  } else {
    return NextResponse.redirect(new URL("/login?error=missing_token", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
