import "server-only";

import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";

/**
 * Wrappers fins autour de Google Calendar v3. Fetch direct, sans SDK.
 * Tous les helpers attendent un `accessToken` valide.
 */

const API_BASE = "https://www.googleapis.com/calendar/v3";

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
  accessRole?: string;
  hidden?: boolean;
  deleted?: boolean;
};

export type GoogleEvent = {
  id: string;
  iCalUID?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }>;
  recurringEventId?: string;
  updated?: string;
  transparency?: string;
};

async function calFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    timeoutMs: 6000,
    label: `Calendar API ${path.split("?")[0]}`,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API ${res.status} : ${text}`);
  }
  return (await res.json()) as T;
}

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const data = await calFetch<{ items?: GoogleCalendarListEntry[] }>(
    "/users/me/calendarList?minAccessRole=reader",
    accessToken,
  );
  return (data.items ?? []).filter((c) => !c.deleted && !c.hidden);
}

/**
 * Liste les events d'un calendrier dans une fenêtre donnée. Pagination
 * gérée transparemment (boucle sur `nextPageToken`).
 *
 * `singleEvents=true` + `orderBy=startTime` déplie les récurrences en
 * occurrences individuelles, ce qui est ce qu'on veut afficher.
 */
export async function listGoogleEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  accessToken: string,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      showDeleted: "false",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await calFetch<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      accessToken,
    );
    if (data.items) events.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * Convertit un event Google en row prête à insert dans `calendar_events`.
 * Gère les events all-day (`start.date` au lieu de `start.dateTime`) en
 * traitant la date comme minuit local converti en UTC.
 */
export function googleEventToRow(event: GoogleEvent): {
  startAt: Date;
  endAt: Date;
  allDay: boolean;
} | null {
  const startStr = event.start.dateTime ?? event.start.date;
  const endStr = event.end.dateTime ?? event.end.date;
  if (!startStr || !endStr) return null;

  const allDay = !event.start.dateTime;
  const startAt = new Date(startStr);
  const endAt = new Date(endStr);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;

  return { startAt, endAt, allDay };
}
