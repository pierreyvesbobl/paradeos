import { refreshAllUsersEvents } from "@/lib/actions/calendar";
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
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const result = await refreshAllUsersEvents();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron refresh-calendar-events]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
