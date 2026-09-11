"use server";

import { calendarEvents } from "@/db/schema/calendar-events";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { timeEntries } from "@/db/schema/time-entries";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { getGoogleAccount, getValidAccessToken } from "@/lib/google/account";
import { listGoogleCalendars } from "@/lib/google/calendar-api";
import { refreshUserEvents } from "@/lib/google/calendar-sync";
import {
  attributeCalendarEventSchema,
  toggleCalendarSyncSchema,
  unattributeTimeEntrySchema,
} from "@/lib/schemas/calendar";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
  revalidatePath("/temps");
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
  revalidatePath("/temps");
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
  revalidatePath("/temps");
  return { ok: true };
});

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
      revalidatePath("/temps");
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

    revalidatePath("/temps");
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
  revalidatePath("/temps");
  return { ok: true };
});
