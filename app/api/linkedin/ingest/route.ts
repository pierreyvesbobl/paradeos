/**
 * Endpoint cross-origin appelé par l'extension Chrome « Paradeos Sync ».
 *
 * Contrairement à l'intégration Dougs, aucun cookie n'est transmis ici :
 * l'extension interroge elle-même l'API interne Voyager depuis le
 * navigateur de l'utilisateur (LinkedIn bloque les IP datacenter et
 * restreint les comptes dont la session change d'origine) et ne pousse
 * que du JSON déjà normalisé. Le `li_at` ne quitte jamais la machine.
 *
 * Auth : `Authorization: Bearer paradeos_linkedin_sync_<…>` résolu
 * contre linkedin_sync_tokens.
 *
 * CORS : ouvert. Le token Bearer fait l'auth.
 */
import { ingestConnections, ingestConversations } from "@/lib/linkedin/ingest";
import { LINKEDIN_SYNC_TOKEN_PREFIX, resolveLinkedinSyncToken } from "@/lib/linkedin/sync-tokens";
import { ingestPayloadSchema } from "@/lib/schemas/linkedin";
import { type NextRequest, NextResponse } from "next/server";

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

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const match = auth?.match(
    new RegExp(`^Bearer\\s+(${LINKEDIN_SYNC_TOKEN_PREFIX}[A-Za-z0-9_-]+)$`),
  );
  if (!match || !match[1]) {
    return withCors(
      NextResponse.json({ ok: false, error: "Token manquant ou mal formé." }, { status: 401 }),
    );
  }
  const resolved = await resolveLinkedinSyncToken(match[1]);
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
  const parsed = ingestPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "Payload invalide.",
          details: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        { status: 400 },
      ),
    );
  }

  try {
    const result =
      parsed.data.kind === "conversations"
        ? await ingestConversations(resolved.userId, parsed.data.items)
        : await ingestConnections(resolved.userId, parsed.data.items);

    return withCors(NextResponse.json({ ok: true, ...result }));
  } catch (err) {
    console.error("[linkedin ingest]", err);
    return withCors(NextResponse.json({ ok: false, error: "Erreur interne." }, { status: 500 }));
  }
}
