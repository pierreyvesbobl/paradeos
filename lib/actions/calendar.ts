"use server";

import { calendarEvents } from "@/db/schema/calendar-events";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { timeEntries } from "@/db/schema/time-entries";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { getGoogleAccount, getValidAccessToken } from "@/lib/google/account";
import {
  type GoogleEvent,
  googleEventToRow,
  listGoogleCalendars,
  listGoogleEvents,
} from "@/lib/google/calendar-api";
import {
  attributeCalendarEventSchema,
  toggleCalendarSyncSchema,
  unattributeTimeEntrySchema,
} from "@/lib/schemas/calendar";
import { and, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const FETCH_WINDOW_FUTURE_DAYS = 30;
const FETCH_WINDOW_PAST_DAYS = 7;

/**
 * Récupère la liste des calendriers de l'user depuis Google et upsert
 * dans `google_calendars`. Idempotent : ne touche pas à `sync_enabled`
 * pour ne pas écraser les choix de l'user.
 */
export const refreshCalendarList = action(z.object({}), async ({ user }) => {
  const account = await getGoogleAccount(user.id);
  if (!account) throw new Error("Google Drive non connecté.");
  const accessToken = await getValidAccessToken(user.id);
  if (!accessToken) throw new Error("Token Google invalide — reconnecte-toi.");

  const items = await listGoogleCalendars(accessToken);
  const conn = await db();

  for (const cal of items) {
    const summary = cal.summaryOverride ?? cal.summary ?? cal.id;
    await conn
      .insert(googleCalendars)
      .values({
        googleAccountId: account.id,
        calendarId: cal.id,
        summary,
        description: cal.description ?? null,
        isPrimary: cal.primary ?? false,
        backgroundColor: cal.backgroundColor ?? null,
        foregroundColor: cal.foregroundColor ?? null,
        // Premier import : on active automatiquement le calendrier primaire,
        // l'user ajustera ensuite.
        syncEnabled: cal.primary ?? false,
      })
      .onConflictDoUpdate({
        target: [googleCalendars.googleAccountId, googleCalendars.calendarId],
        set: {
          summary,
          description: cal.description ?? null,
          isPrimary: cal.primary ?? false,
          backgroundColor: cal.backgroundColor ?? null,
          foregroundColor: cal.foregroundColor ?? null,
          updatedAt: new Date(),
        },
      });
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/planning");
  return { count: items.length };
});

export const toggleCalendarSync = action(toggleCalendarSyncSchema, async ({ input, user }) => {
  const conn = await db();
  // Vérifie que ce calendrier appartient bien au user (via le compte)
  const [row] = await conn
    .select({ id: googleCalendars.id })
    .from(googleCalendars)
    .innerJoin(googleAccounts, eq(googleAccounts.id, googleCalendars.googleAccountId))
    .where(and(eq(googleCalendars.id, input.calendarId), eq(googleAccounts.userId, user.id)))
    .limit(1);
  if (!row) throw new Error("Calendrier introuvable.");

  await conn
    .update(googleCalendars)
    .set({ syncEnabled: input.enabled, updatedAt: new Date() })
    .where(eq(googleCalendars.id, input.calendarId));

  revalidatePath("/settings/integrations");
  revalidatePath("/planning");
  return { ok: true };
});

/**
 * Refresh complet des events sur la fenêtre [now-7j, now+30j] pour
 * tous les calendriers actifs du user. Stratégie simple en v1 :
 * delete + insert par calendrier dans la fenêtre. Évite la complexité
 * du diff partiel ; les volumes hebdo restent modestes (typiquement
 * < 100 events).
 */
export const refreshCalendarEvents = action(z.object({}), async ({ user }) => {
  await refreshUserEvents(user.id);
  revalidatePath("/planning");
  return { ok: true };
});

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
 * Attribue un event Google Calendar à un projet/tâche/contact en
 * créant un `time_entry` qui mirror l'event (mêmes start/end/title).
 * L'event Google reste en cache, mais sera filtré de l'affichage
 * /planning grâce au lien (`google_event_id`).
 *
 * Default kind : `actual` si l'event est passé, `planned` sinon.
 * L'utilisateur peut overrider via le dialog.
 */
export const attributeCalendarEvent = action(
  attributeCalendarEventSchema,
  async ({ input, user }) => {
    const conn = await db();
    const [event] = await conn
      .select({
        id: calendarEvents.id,
        googleEventId: calendarEvents.googleEventId,
        googleCalendarId: calendarEvents.googleCalendarId,
        summary: calendarEvents.summary,
        description: calendarEvents.description,
        startAt: calendarEvents.startAt,
        endAt: calendarEvents.endAt,
      })
      .from(calendarEvents)
      .innerJoin(googleCalendars, eq(googleCalendars.id, calendarEvents.googleCalendarId))
      .innerJoin(googleAccounts, eq(googleAccounts.id, googleCalendars.googleAccountId))
      .where(and(eq(calendarEvents.id, input.calendarEventId), eq(googleAccounts.userId, user.id)))
      .limit(1);

    if (!event) throw new Error("Event introuvable.");

    const kind =
      input.kind ??
      (event.endAt.getTime() <= Date.now() ? ("actual" as const) : ("planned" as const));

    // Si déjà attribué (re-clic), on update plutôt que de doubler.
    const [existing] = await conn
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, user.id),
          eq(timeEntries.googleCalendarId, event.googleCalendarId),
          eq(timeEntries.googleEventId, event.googleEventId),
        ),
      )
      .limit(1);

    if (existing) {
      await conn
        .update(timeEntries)
        .set({
          kind,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
          contactId: input.contactId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, existing.id));
      revalidatePath("/planning");
      return { id: existing.id, created: false as const };
    }

    const [row] = await conn
      .insert(timeEntries)
      .values({
        userId: user.id,
        kind,
        startAt: event.startAt,
        endAt: event.endAt,
        title: event.summary ?? "Sans titre",
        description: event.description ?? null,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        contactId: input.contactId ?? null,
        googleEventId: event.googleEventId,
        googleCalendarId: event.googleCalendarId,
      })
      .returning({ id: timeEntries.id });

    revalidatePath("/planning");
    return { id: row?.id, created: true as const };
  },
);

/**
 * Retire l'attribution d'un event Google : supprime le time_entry
 * correspondant. L'event Google réapparaîtra dans la vue (lecture seule).
 */
export const unattributeTimeEntry = action(unattributeTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .delete(timeEntries)
    .where(and(eq(timeEntries.id, input.timeEntryId), eq(timeEntries.userId, user.id)));
  revalidatePath("/planning");
  return { ok: true };
});

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
