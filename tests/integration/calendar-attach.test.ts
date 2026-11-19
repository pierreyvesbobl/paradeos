import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { calendarEventLinks } from "@/db/schema/calendar-event-links";
import { calendarEvents } from "@/db/schema/calendar-events";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { meetings } from "@/db/schema/meetings";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import { attributeCalendarEvent } from "@/lib/actions/calendar";
import { deleteTimeEntry } from "@/lib/actions/time-entries";
import { calendarEventKey, getCalendarSuggestionsForEvents } from "@/lib/db/queries/calendar";
import { attachCalendarEvents, evaluateCalendarEvents } from "@/lib/time/calendar-attach";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Un rendez-vous Google reconnu devient un créneau réalisé quand il est passé
 * et que l'utilisateur y a pris part ; sinon il reste « reconnu », à imputer
 * d'un clic. Un créneau supprimé vaut refus définitif ; une réunion Parade OS
 * tenue sur le créneau reçoit le projet du rendez-vous.
 */

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let calendarId: string;
let gpasId: string;
let gpas2Id: string;
let geekId: string;
let gpasContactId: string;
let geekContactId: string;

const now = new Date("2026-11-19T12:00:00Z");
const at = (day: number, h: number, min = 0) => new Date(Date.UTC(2026, 10, day, h, min));
const self = (responseStatus: string) => ({
  self: true,
  email: "py@bobl.fr",
  responseStatus,
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  actAs(actor);

  const [account] = await db
    .insert(googleAccounts)
    .values({
      userId: actor.id,
      googleSub: "sub",
      email: "py@bobl.fr",
      accessTokenEnc: "x",
      refreshTokenEnc: "x",
      expiresAt: now,
      scopes: [],
    })
    .returning({ id: googleAccounts.id });
  if (!account) throw new Error("account");
  const [cal] = await db
    .insert(googleCalendars)
    .values({
      googleAccountId: account.id,
      calendarId: "primary",
      summary: "py@bobl.fr",
      isPrimary: true,
      syncEnabled: true,
    })
    .returning({ id: googleCalendars.id });
  if (!cal) throw new Error("calendar");
  calendarId = cal.id;

  const [gpas, geek] = await db
    .insert(entities)
    .values([
      { name: "GpasPlus", kind: "client", website: "https://www.gpasplus.com" },
      { name: "The Geek Family", kind: "client" },
    ])
    .returning({ id: entities.id });
  if (!gpas || !geek) throw new Error("entities");
  const [p1, p2, p3] = await db
    .insert(projects)
    .values([
      { name: "GpasPlus - Automatisation", kind: "client", status: "active", entityId: gpas.id },
      { name: "GpasPlus - Qualité", kind: "client", status: "active", entityId: gpas.id },
      {
        name: "The Geek Family - Partenariat IA",
        kind: "client",
        status: "active",
        entityId: geek.id,
      },
    ])
    .returning({ id: projects.id });
  if (!p1 || !p2 || !p3) throw new Error("projects");
  gpasId = p1.id;
  gpas2Id = p2.id;
  geekId = p3.id;

  const [c1, c2] = await db
    .insert(contacts)
    .values([
      { firstName: "Olivier", lastName: "Gpas", email: "Olivier@GpasPlus.com", entityId: gpas.id },
      { firstName: "Gina", lastName: "Geek", email: "gina@geekfamily.fr", entityId: geek.id },
    ])
    .returning({ id: contacts.id });
  if (!c1 || !c2) throw new Error("contacts");
  gpasContactId = c1.id;
  geekContactId = c2.id;
  await db.insert(projectContacts).values([
    { projectId: gpasId, contactId: gpasContactId },
    { projectId: geekId, contactId: geekContactId },
  ]);
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

async function event(
  googleEventId: string,
  summary: string,
  startAt: Date,
  endAt: Date,
  attendees: unknown[] | null,
  extra: Partial<typeof calendarEvents.$inferInsert> = {},
) {
  const [row] = await db
    .insert(calendarEvents)
    .values({
      googleCalendarId: calendarId,
      googleEventId,
      summary,
      startAt,
      endAt,
      attendees,
      status: "confirmed",
      ...extra,
    })
    .returning({ id: calendarEvents.id });
  if (!row) throw new Error("event");
  return row.id;
}

const linkOf = async (googleEventId: string) =>
  (
    await db
      .select()
      .from(calendarEventLinks)
      .where(
        and(
          eq(calendarEventLinks.googleCalendarId, calendarId),
          eq(calendarEventLinks.googleEventId, googleEventId),
        ),
      )
  )[0];

const entriesOf = async (googleEventId: string) =>
  db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, actor.id), eq(timeEntries.googleEventId, googleEventId)));

describe("rendez-vous → projet → temps", () => {
  it("pose un créneau réalisé sur un rendez-vous passé, reconnu et accepté", async () => {
    await event("past-gpas", "Point hebdo", at(18, 9), at(18, 10), [
      self("accepted"),
      { email: "olivier@gpasplus.com", responseStatus: "accepted" },
    ]);
    const result = await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(result.applied).toBe(1);

    const [entry] = await entriesOf("past-gpas");
    expect(entry).toMatchObject({
      kind: "actual",
      source: "calendar",
      projectId: gpasId,
      contactId: gpasContactId,
      title: "Point hebdo",
    });
    const link = await linkOf("past-gpas");
    expect(link).toMatchObject({ status: "applied", projectId: gpasId, timeEntryId: entry?.id });
    expect(link?.autoAt).not.toBeNull();
    expect(link?.reasons).toContain("attendees");
    // Un contact à un seul projet et le domaine du client : deux indices concordants.
    expect(link?.reasons).toContain("client");
  });

  it("ne pose rien deux fois", async () => {
    const result = await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(result.applied).toBe(0);
    expect(await entriesOf("past-gpas")).toHaveLength(1);
  });

  it("laisse à imputer un rendez-vous à venir, ou dont la présence n'est pas confirmée", async () => {
    await event("future-geek", "R1 The Geek Family - Partenariat IA", at(25, 9), at(25, 10), [
      self("accepted"),
    ]);
    await event("unconfirmed", "Call GpasPlus", at(17, 9), at(17, 10), [
      self("needsAction"),
      { email: "olivier@gpasplus.com", responseStatus: "accepted" },
    ]);
    await attachCalendarEvents(db, actor.id, { autoTime: true, now });

    expect(await linkOf("future-geek")).toMatchObject({ status: "suggested", projectId: geekId });
    expect(await entriesOf("future-geek")).toHaveLength(0);
    expect(await linkOf("unconfirmed")).toMatchObject({ status: "suggested", projectId: gpasId });
    expect(await entriesOf("unconfirmed")).toHaveLength(0);

    const suggestions = await getCalendarSuggestionsForEvents(actor.id, [
      { googleCalendarId: calendarId, googleEventId: "future-geek" },
    ]);
    expect(suggestions.get(calendarEventKey(calendarId, "future-geek"))?.projectName).toBe(
      "The Geek Family - Partenariat IA",
    );
  });

  it("ne tranche pas un rendez-vous sans indice, ni un rendez-vous entre deux clients", async () => {
    await event("lunch", "Déjeuner", at(16, 12), at(16, 13), null);
    await event("mixed", "Point partenaires", at(16, 14), at(16, 15), [
      self("accepted"),
      { email: "olivier@gpasplus.com" },
      { email: "gina@geekfamily.fr" },
    ]);
    await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(await linkOf("lunch")).toMatchObject({ status: "unmatched", projectId: null });
    expect(await linkOf("mixed")).toMatchObject({ status: "unmatched", projectId: null });
    expect(await entriesOf("mixed")).toHaveLength(0);
  });

  it("un client à deux projets ne suffit pas sans le titre", async () => {
    await db
      .insert(projectContacts)
      .values({ projectId: gpas2Id, contactId: gpasContactId })
      .onConflictDoNothing();
    await event("ambiguous", "Point", at(13, 9), at(13, 10), [
      self("accepted"),
      { email: "olivier@gpasplus.com" },
    ]);
    await event("titled", "Point Qualité", at(13, 11), at(13, 12), [
      self("accepted"),
      { email: "olivier@gpasplus.com" },
    ]);
    const evaluations = await evaluateCalendarEvents(db, actor.id, now);
    expect(evaluations.find((e) => e.googleEventId === "ambiguous")?.decision).toBeNull();
    expect(evaluations.find((e) => e.googleEventId === "titled")?.decision?.projectId).toBe(
      gpas2Id,
    );
    await db
      .delete(projectContacts)
      .where(
        and(eq(projectContacts.projectId, gpas2Id), eq(projectContacts.contactId, gpasContactId)),
      );
  });

  it("donne le projet du rendez-vous à la réunion sans projet tenue sur le créneau", async () => {
    const [m] = await db
      .insert(meetings)
      .values({
        title: "16 nov. à 09:02",
        transcript: "…",
        status: "extracted",
        occurredAt: at(16, 9, 2),
        createdBy: actor.id,
      })
      .returning({ id: meetings.id });
    if (!m) throw new Error("meeting");
    await event("with-meeting", "Démo", at(16, 9), at(16, 10), [
      self("accepted"),
      { email: "someone@gpasplus.com" },
    ]);
    // Domaine seul (0,6) : pas assez. Avec le nom du client dans le titre, oui.
    expect(
      (await evaluateCalendarEvents(db, actor.id, now)).find(
        (e) => e.googleEventId === "with-meeting",
      ),
    ).toMatchObject({ decision: null, meetingId: m.id, meetingNeedsProject: true });

    await db
      .update(calendarEvents)
      .set({ summary: "Démo GpasPlus Qualité" })
      .where(eq(calendarEvents.googleEventId, "with-meeting"));
    const result = await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(result.meetingsAttached).toBe(1);
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(meeting?.projectId).toBe(gpas2Id);
    expect(meeting?.projectAutoReason).toMatch(/^calendar:/);
    expect(await linkOf("with-meeting")).toMatchObject({ status: "applied", meetingId: m.id });
  });

  it("supprimer le créneau vaut refus : la relève ne le repose pas", async () => {
    const [entry] = await entriesOf("past-gpas");
    if (!entry) throw new Error("entry");
    const res = await deleteTimeEntry({ id: entry.id });
    expect(res.ok).toBe(true);
    expect(await linkOf("past-gpas")).toMatchObject({ status: "dismissed", timeEntryId: null });
    await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(await entriesOf("past-gpas")).toHaveLength(0);
    expect((await linkOf("past-gpas"))?.status).toBe("dismissed");
  });

  it("une imputation à la main depuis la grille ferme le lien sans auto_at", async () => {
    const [ev] = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(eq(calendarEvents.googleEventId, "future-geek"));
    if (!ev) throw new Error("event");
    const res = await attributeCalendarEvent({ calendarEventId: ev.id, projectId: gpasId });
    expect(res.ok).toBe(true);
    const link = await linkOf("future-geek");
    expect(link).toMatchObject({ status: "applied", projectId: gpasId, reasons: "manual" });
    expect(link?.autoAt).toBeNull();
    await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(await entriesOf("future-geek")).toHaveLength(1);
  });

  it("réglage éteint : le rendez-vous reconnu reste à imputer", async () => {
    await event("off", "Point GpasPlus Automatisation", at(12, 9), at(12, 10), [self("accepted")]);
    await attachCalendarEvents(db, actor.id, { autoTime: false, now });
    expect(await linkOf("off")).toMatchObject({ status: "suggested", projectId: gpasId });
    expect(await entriesOf("off")).toHaveLength(0);
    // Rallumé : posé à la relève suivante.
    await attachCalendarEvents(db, actor.id, { autoTime: true, now });
    expect(await entriesOf("off")).toHaveLength(1);
  });
});
