import "server-only";

import { calendarEvents } from "@/db/schema/calendar-events";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { db } from "@/lib/db/server";
import { and, asc, between, eq, getTableColumns } from "drizzle-orm";

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
  // Une seule requête (join calendriers + comptes) et pas de colonne
  // `attendees` (JSON brut, jamais affiché) : c'était la colonne la plus
  // lourde de la table pour le planning et le dashboard.
  const { attendees: _attendees, ...eventColumns } = getTableColumns(calendarEvents);
  return conn
    .select({
      ...eventColumns,
      calendarSummary: googleCalendars.summary,
      calendarBackgroundColor: googleCalendars.backgroundColor,
      calendarForegroundColor: googleCalendars.foregroundColor,
    })
    .from(calendarEvents)
    .innerJoin(googleCalendars, eq(googleCalendars.id, calendarEvents.googleCalendarId))
    .innerJoin(googleAccounts, eq(googleAccounts.id, googleCalendars.googleAccountId))
    .where(
      and(
        eq(googleAccounts.userId, userId),
        eq(googleCalendars.syncEnabled, true),
        between(calendarEvents.startAt, from, to),
      ),
    )
    .orderBy(asc(calendarEvents.startAt));
}
