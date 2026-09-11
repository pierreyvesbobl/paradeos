/**
 * Synchronisation des événements Google Calendar vers `calendar_events`.
 *
 * Ces fonctions prennent un `userId` explicite et ne vérifient PAS
 * l'authentification : elles sont réservées aux appelants serveur de
 * confiance (Server Action `refreshCalendarEvents` qui passe `user.id`,
 * cron `refresh-calendar-events` protégé par CRON_SECRET). Elles ne
 * doivent jamais vivre dans un fichier `"use server"`, sinon Next les
 * expose comme endpoints appelables sans auth.
 */
import { calendarEvents } from "@/db/schema/calendar-events";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { db } from "@/lib/db/server";
import { getGoogleAccount, getValidAccessToken } from "@/lib/google/account";
import { type GoogleEvent, googleEventToRow, listGoogleEvents } from "@/lib/google/calendar-api";
import { and, eq, gte } from "drizzle-orm";

const FETCH_WINDOW_FUTURE_DAYS = 30;
const FETCH_WINDOW_PAST_DAYS = 7;

export async function refreshUserEvents(userId: string): Promise<{ totalEvents: number }> {
  const account = await getGoogleAccount(userId);
  if (!account) return { totalEvents: 0 };
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return { totalEvents: 0 };

  const conn = await db();
  const enabledCalendars = await conn
    .select()
    .from(googleCalendars)
    .where(
      and(eq(googleCalendars.googleAccountId, account.id), eq(googleCalendars.syncEnabled, true)),
    );

  if (enabledCalendars.length === 0) return { totalEvents: 0 };

  const now = new Date();
  const timeMin = new Date(now.getTime() - FETCH_WINDOW_PAST_DAYS * 86400_000);
  const timeMax = new Date(now.getTime() + FETCH_WINDOW_FUTURE_DAYS * 86400_000);

  let totalEvents = 0;

  for (const cal of enabledCalendars) {
    let events: GoogleEvent[];
    try {
      events = await listGoogleEvents(cal.calendarId, timeMin, timeMax, accessToken);
    } catch (err) {
      console.warn("[calendar refresh] events list failed", cal.calendarId, err);
      continue;
    }

    // Suppression simple des events existants dans la fenêtre, puis
    // re-insert. Plus simple à raisonner que le diff, et le coût est
    // borné par la fenêtre (pas l'historique entier).
    await conn
      .delete(calendarEvents)
      .where(
        and(eq(calendarEvents.googleCalendarId, cal.id), gte(calendarEvents.startAt, timeMin)),
      );

    const rows = events
      .map((e) => {
        const range = googleEventToRow(e);
        if (!range) return null;
        return {
          googleCalendarId: cal.id,
          googleEventId: e.id,
          icalUid: e.iCalUID ?? null,
          summary: e.summary ?? null,
          description: e.description ?? null,
          location: e.location ?? null,
          startAt: range.startAt,
          endAt: range.endAt,
          allDay: range.allDay,
          status: e.status ?? null,
          htmlLink: e.htmlLink ?? null,
          organizerEmail: e.organizer?.email ?? null,
          attendees: e.attendees ?? null,
          recurringEventId: e.recurringEventId ?? null,
          googleUpdatedAt: e.updated ? new Date(e.updated) : null,
          fetchedAt: new Date(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      // Batch insert. La contrainte UNIQUE(google_calendar_id, google_event_id)
      // garantit l'idempotence si un event est listé plusieurs fois.
      await conn.insert(calendarEvents).values(rows).onConflictDoNothing();
      totalEvents += rows.length;
    }

    await conn
      .update(googleCalendars)
      .set({ lastSyncedAt: new Date() })
      .where(eq(googleCalendars.id, cal.id));
  }

  return { totalEvents };
}

/**
 * Refresh événements pour TOUS les users avec au moins un calendrier
 * actif. Utilisé par le cron 15 min.
 */
export async function refreshAllUsersEvents(): Promise<{ users: number; events: number }> {
  const conn = await db();
  const rows = await conn
    .selectDistinct({ userId: googleAccounts.userId })
    .from(googleAccounts)
    .innerJoin(googleCalendars, eq(googleCalendars.googleAccountId, googleAccounts.id))
    .where(eq(googleCalendars.syncEnabled, true));

  let totalEvents = 0;
  for (const r of rows) {
    try {
      const { totalEvents: n } = await refreshUserEvents(r.userId);
      totalEvents += n;
    } catch (err) {
      console.warn("[calendar cron] user refresh failed", r.userId, err);
    }
  }
  return { users: rows.length, events: totalEvents };
}
