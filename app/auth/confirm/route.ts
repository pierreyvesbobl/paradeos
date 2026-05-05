import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Confirme un OTP / magic link via `verifyOtp` côté serveur. À utiliser
 * avec un lien construit comme :
 *   /auth/confirm?token_hash=<hash>&type=magiclink&next=/
 *
 * Compatible avec les liens générés via `admin.generateLink()` :
 * `data.properties.hashed_token` → `token_hash`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/";

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=missing_token", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
