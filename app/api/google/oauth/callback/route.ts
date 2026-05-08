import { googleAccounts } from "@/db/schema/google-accounts";
import { requireUser } from "@/lib/auth/server";
import { encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db/server";
import { GOOGLE_DRIVE_SCOPES, decodeIdTokenPayload, exchangeCode } from "@/lib/google/oauth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const STATE_COOKIE = "g_oauth_state";

/**
 * Callback OAuth Google. Vérifie le `state`, échange le code contre
 * tokens, upsert le compte. Redirige vers /settings/integrations avec
 * un query param `?google=connected|error_*` pour que la page affiche
 * un toast.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const c = await cookies();
  const expectedState = c.get(STATE_COOKIE)?.value;
  c.delete(STATE_COOKIE);

  const back = (status: string) =>
    NextResponse.redirect(new URL(`/settings/integrations?google=${status}`, req.url));

  if (errorParam) return back(`error_${errorParam}`);
  if (!code || !state) return back("error_missing_params");
  if (!expectedState || expectedState !== state) return back("error_state");

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("[google oauth] exchange failed", err);
    return back("error_exchange");
  }

  if (!tokens.refresh_token || !tokens.id_token) {
    return back("error_missing_refresh");
  }

  const idInfo = decodeIdTokenPayload(tokens.id_token);
  const email = idInfo.email;
  if (!email) return back("error_no_email");

  const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  const scopes = grantedScopes.length > 0 ? grantedScopes : GOOGLE_DRIVE_SCOPES;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const conn = await db();
  await conn
    .insert(googleAccounts)
    .values({
      userId: user.id,
      googleSub: idInfo.sub,
      email,
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc: encryptSecret(tokens.refresh_token),
      expiresAt,
      scopes,
    })
    .onConflictDoUpdate({
      target: googleAccounts.userId,
      set: {
        googleSub: idInfo.sub,
        email,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        expiresAt,
        scopes,
        revokedAt: null,
        updatedAt: new Date(),
      },
    });

  return back("connected");
}
