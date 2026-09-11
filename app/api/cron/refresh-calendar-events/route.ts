import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { refreshAllUsersEvents } from "@/lib/google/calendar-sync";
import { NextResponse } from "next/server";

/**
 * Cron 15 min : refresh les events des calendriers actifs pour tous
 * les users.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>` (Vercel pose ce header
 * automatiquement quand `CRON_SECRET` est défini en env).
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await refreshAllUsersEvents();
    return cronResponse(result);
  } catch (err) {
    console.error("[cron refresh-calendar-events]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
