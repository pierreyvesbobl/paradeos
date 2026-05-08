import "server-only";

import { calendarEvents } from "@/db/schema/calendar-events";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { db } from "@/lib/db/server";
import { and, asc, between, eq, inArray } from "drizzle-orm";

export async function getCalendarsForUser(userId: string) {
  const conn = await db();
  const rows = await conn
    .select({
      id: googleCalendars.id,
      calendarId: googleCalendars.calendarId,
      summary: googleCalendars.summary,
      description: googleCalendars.description,
      isPrimary: googleCalendars.isPrimary,
      backgroundColor: googleCalendars.backgroundColor,
      foregroundColor: googleCalendars.foregroundColor,
      syncEnabled: googleCalendars.syncEnabled,
      lastSyncedAt: googleCalendars.lastSyncedAt,
    })
    .from(googleCalendars)
    .innerJoin(googleAccounts, eq(googleAccounts.id, googleCalendars.googleAccountId))
    .where(eq(googleAccounts.userId, userId))
    .orderBy(asc(googleCalendars.summary));
  return rows;
}

/**
 * Renvoie les events Google des calendriers actifs (`syncEnabled`) du
 * user, dont la fenêtre [start_at, end_at] intersecte [from, to].
 * On utilise un BETWEEN sur start_at — en pratique les events plus
 * longs que la fenêtre sont rares dans un planning hebdo.
 */
export async function getCalendarEventsForRange(userId: string, from: Date, to: Date) {
  const conn = await db();
  const calendarRows = await conn
    .select({
      id: googleCalendars.id,
      summary: googleCalendars.summary,
      backgroundColor: googleCalendars.backgroundColor,
      foregroundColor: googleCalendars.foregroundColor,
    })
    .from(googleCalendars)
    .innerJoin(googleAccounts, eq(googleAccounts.id, googleCalendars.googleAccountId))
    .where(and(eq(googleAccounts.userId, userId), eq(googleCalendars.syncEnabled, true)));

  if (calendarRows.length === 0) return [];

  const calIds = calendarRows.map((c) => c.id);
  const events = await conn
    .select()
    .from(calendarEvents)
    .where(
      and(
        inArray(calendarEvents.googleCalendarId, calIds),
        between(calendarEvents.startAt, from, to),
      ),
    )
    .orderBy(asc(calendarEvents.startAt));

  const calMeta = new Map(calendarRows.map((c) => [c.id, c]));
  return events.map((e) => ({
    ...e,
    calendarSummary: calMeta.get(e.googleCalendarId)?.summary ?? null,
    calendarBackgroundColor: calMeta.get(e.googleCalendarId)?.backgroundColor ?? null,
    calendarForegroundColor: calMeta.get(e.googleCalendarId)?.foregroundColor ?? null,
  }));
}
