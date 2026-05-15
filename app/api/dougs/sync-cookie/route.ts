/**
 * Endpoint cross-origin appelé par l'extension Chrome
 * "Paradeos Dougs Sync" depuis n'importe quelle origine. Reçoit le
 * cookie de session Dougs (HttpOnly inclus, lu par l'extension via
 * chrome.cookies.getAll), le chiffre AES-256-GCM et upsert dans la
 * table dougs_sessions.
 *
 * Auth : `Authorization: Bearer paradeos_dougs_sync_<…>` résolu contre
 * dougs_sync_tokens.
 *
 * CORS : ouvert. Le token Bearer fait l'auth.
 */
import { dougsSessions } from "@/db/schema/dougs";
import { db } from "@/lib/db/server";
import { encryptCookie } from "@/lib/dougs/crypto";
import { DOUGS_SYNC_TOKEN_PREFIX, resolveSyncToken } from "@/lib/dougs/sync-tokens";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

const bodySchema = z.object({
  cookie: z.string().trim().min(20),
  companyId: z.string().trim().regex(/^\d+$/).optional(),
});

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const match = auth?.match(new RegExp(`^Bearer\\s+(${DOUGS_SYNC_TOKEN_PREFIX}[A-Za-z0-9_-]+)$`));
  if (!match || !match[1]) {
    return withCors(
      NextResponse.json({ ok: false, error: "Token manquant ou mal formé." }, { status: 401 }),
    );
  }
  const resolved = await resolveSyncToken(match[1]);
  if (!resolved) {
    return withCors(
      NextResponse.json({ ok: false, error: "Token invalide ou révoqué." }, { status: 401 }),
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return withCors(NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 }));
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "Payload invalide." }, { status: 400 }));
  }

  try {
    const conn = await db();
    const encrypted = encryptCookie(parsed.data.cookie);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const companyId = parsed.data.companyId ?? "107610";

    const [existing] = await conn
      .select({ id: dougsSessions.id })
      .from(dougsSessions)
      .where(eq(dougsSessions.userId, resolved.userId))
      .limit(1);

    if (existing) {
      await conn
        .update(dougsSessions)
        .set({
          cookieEncrypted: encrypted,
          companyId,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(dougsSessions.id, existing.id));
    } else {
      await conn.insert(dougsSessions).values({
        userId: resolved.userId,
        cookieEncrypted: encrypted,
        companyId,
        expiresAt,
      });
    }

    return withCors(NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() }));
  } catch (err) {
    console.error("[dougs sync-cookie]", err);
    return withCors(NextResponse.json({ ok: false, error: "Erreur interne." }, { status: 500 }));
  }
}
