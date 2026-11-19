import "server-only";

import { and, asc, between, eq, getTableColumns, inArray } from "drizzle-orm";
import { calendarEventLinks } from "@/db/schema/calendar-event-links";
import { calendarEvents } from "@/db/schema/calendar-events";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";

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

export type CalendarSuggestion = {
  projectId: string;
  projectName: string;
  score: number | null;
  reasons: string | null;
  meetingId: string | null;
};

/** Clé d'un rendez-vous dans la carte des suggestions. */
export function calendarEventKey(googleCalendarId: string, googleEventId: string): string {
  return `${googleCalendarId}|${googleEventId}`;
}

/**
 * Projets reconnus sur les rendez-vous encore sans créneau (`suggested`,
 * cf. lib/time/calendar-attach.ts), pour la grille de /temps et l'agenda du
 * jour. Clé : `calendarEventKey`.
 */
export async function getCalendarSuggestionsForEvents(
  userId: string,
  events: readonly { googleCalendarId: string; googleEventId: string }[],
): Promise<Map<string, CalendarSuggestion>> {
  const out = new Map<string, CalendarSuggestion>();
  const calendarIds = [...new Set(events.map((e) => e.googleCalendarId))];
  if (calendarIds.length === 0) return out;
  const wanted = new Set(events.map((e) => calendarEventKey(e.googleCalendarId, e.googleEventId)));
  const conn = await db();
  const rows = await conn
    .select({
      googleCalendarId: calendarEventLinks.googleCalendarId,
      googleEventId: calendarEventLinks.googleEventId,
      projectId: projects.id,
      projectName: projects.name,
      score: calendarEventLinks.score,
      reasons: calendarEventLinks.reasons,
      meetingId: calendarEventLinks.meetingId,
    })
    .from(calendarEventLinks)
    .innerJoin(projects, eq(projects.id, calendarEventLinks.projectId))
    .where(
      and(
        eq(calendarEventLinks.userId, userId),
        eq(calendarEventLinks.status, "suggested"),
        inArray(calendarEventLinks.googleCalendarId, calendarIds),
      ),
    );
  for (const r of rows) {
    const key = calendarEventKey(r.googleCalendarId, r.googleEventId);
    if (!wanted.has(key)) continue;
    out.set(key, {
      projectId: r.projectId,
      projectName: r.projectName,
      score: r.score === null ? null : Number(r.score),
      reasons: r.reasons,
      meetingId: r.meetingId,
    });
  }
  return out;
}
