import { and, eq, gte, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { calendarEventLinks } from "@/db/schema/calendar-event-links";
import { calendarEvents } from "@/db/schema/calendar-events";
import { contactEmails } from "@/db/schema/contact-emails";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { googleAccounts } from "@/db/schema/google-accounts";
import { googleCalendars } from "@/db/schema/google-calendars";
import { meetings } from "@/db/schema/meetings";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import type { NamedProject } from "@/lib/meetings/project-signals";
import {
  attendeeSignals,
  type CalendarDecision,
  type CalendarSignal,
  calendarTitleSignals,
  decideCalendarProject,
  describeDecision,
  domainSignals,
  type EntityDomain,
  eventIneligibility,
  externalAttendees,
  hasEnded,
  type Ineligibility,
  MEETING_MATCH_TOLERANCE_MS,
  matchMeeting,
  meetingSignal,
  parseAttendees,
  websiteDomain,
} from "./calendar-signals";

/**
 * Rendez-vous Google Calendar → projet → temps.
 *
 * Après chaque relève du calendrier, chaque rendez-vous en cache est évalué :
 * titre, invités (contacts du CRM, domaine de leur adresse), réunion Parade OS
 * tenue au même moment. Quand les indices concordent (cf. calendar-signals.ts),
 * le rendez-vous est rattaché au projet. S'il est passé, que l'utilisateur y
 * a bien pris part et que le réglage le permet, un créneau réalisé est posé
 * sans clic, miroir du rendez-vous (`time_entries.source = calendar`). Sinon
 * il reste « reconnu » dans la grille de /temps, à imputer d'un clic.
 *
 * La décision survit au cache dans `calendar_event_links`. Un créneau
 * supprimé par l'humain marque le rendez-vous `dismissed` : on n'y revient
 * pas. Une réunion Parade OS retrouvée sur le créneau et sans projet reçoit
 * celui du rendez-vous.
 *
 * Prend l'une ou l'autre connexion Drizzle (Next ou MCP), comme
 * lib/time/claude-blocks.ts.
 */

const CLOSED_PROJECT_STATUSES = ["lost", "completed", "archived"] as const;

export type CalendarEvaluation = {
  calendarEventId: string;
  googleCalendarId: string;
  googleEventId: string;
  summary: string | null;
  startAt: Date;
  endAt: Date;
  decision: CalendarDecision | null;
  signals: CalendarSignal[];
  ineligible: Ineligibility | null;
  ended: boolean;
  meetingId: string | null;
  /** La réunion appariée n'a pas de projet et n'a jamais été visée : on peut lui donner celui-ci. */
  meetingNeedsProject: boolean;
  /** Le contact invité, quand il n'y en a qu'un de connu : rattaché au créneau. */
  contactId: string | null;
};

type EventRow = {
  id: string;
  googleCalendarId: string;
  googleEventId: string;
  summary: string | null;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  status: string | null;
  attendees: unknown;
};

async function userEvents(conn: Database, userId: string): Promise<EventRow[]> {
  return conn
    .select({
      id: calendarEvents.id,
      googleCalendarId: calendarEvents.googleCalendarId,
      googleEventId: calendarEvents.googleEventId,
      summary: calendarEvents.summary,
      description: calendarEvents.description,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      status: calendarEvents.status,
      attendees: calendarEvents.attendees,
    })
    .from(calendarEvents)
    .innerJoin(googleCalendars, eq(googleCalendars.id, calendarEvents.googleCalendarId))
    .innerJoin(googleAccounts, eq(googleAccounts.id, googleCalendars.googleAccountId))
    .where(and(eq(googleAccounts.userId, userId), eq(googleCalendars.syncEnabled, true)));
}

async function openProjects(conn: Database): Promise<NamedProject[]> {
  return conn
    .select({
      id: projects.id,
      name: projects.name,
      entityId: projects.entityId,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]));
}

async function entityDomains(conn: Database): Promise<EntityDomain[]> {
  const rows = await conn
    .select({ entityId: entities.id, website: entities.website })
    .from(entities)
    .where(isNotNull(entities.website));
  return rows.flatMap((r) => {
    const domain = websiteDomain(r.website);
    return domain ? [{ entityId: r.entityId, domain }] : [];
  });
}

/** Adresses de l'équipe : les comptes Google connectés. */
async function teamEmails(conn: Database): Promise<Set<string>> {
  const rows = await conn.select({ email: googleAccounts.email }).from(googleAccounts);
  return new Set(rows.map((r) => r.email.trim().toLowerCase()));
}

/** email → contact, sur l'adresse principale et les secondaires. */
async function contactsByEmail(
  conn: Database,
  emails: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (emails.length === 0) return out;
  const list = [...emails];
  const [primary, secondary] = await Promise.all([
    conn
      .select({ id: contacts.id, email: sql<string>`lower(${contacts.email})` })
      .from(contacts)
      .where(inArray(sql`lower(${contacts.email})`, list)),
    conn
      .select({ id: contactEmails.contactId, email: sql<string>`lower(${contactEmails.email})` })
      .from(contactEmails)
      .where(inArray(sql`lower(${contactEmails.email})`, list)),
  ]);
  for (const r of [...secondary, ...primary]) out.set(r.email, r.id);
  return out;
}

/** contact → projets ouverts (liens project_contacts + contact principal du projet). */
async function projectsOfContacts(
  conn: Database,
  contactIds: readonly string[],
  openIds: ReadonlySet<string>,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (contactIds.length === 0) return out;
  const ids = [...contactIds];
  const [links, primary] = await Promise.all([
    conn
      .select({ contactId: projectContacts.contactId, projectId: projectContacts.projectId })
      .from(projectContacts)
      .where(inArray(projectContacts.contactId, ids)),
    conn
      .select({ contactId: projects.contactId, projectId: projects.id })
      .from(projects)
      .where(inArray(projects.contactId, ids)),
  ]);
  for (const l of [...links, ...primary]) {
    if (!l.contactId || !openIds.has(l.projectId)) continue;
    const set = out.get(l.contactId) ?? new Set<string>();
    set.add(l.projectId);
    out.set(l.contactId, set);
  }
  return out;
}

type MeetingRow = {
  id: string;
  occurredAt: Date | null;
  projectId: string | null;
  projectAutoAt: Date | null;
};

async function meetingsAround(conn: Database, from: Date, to: Date): Promise<MeetingRow[]> {
  return conn
    .select({
      id: meetings.id,
      occurredAt: meetings.occurredAt,
      projectId: meetings.projectId,
      projectAutoAt: meetings.projectAutoAt,
    })
    .from(meetings)
    .where(
      and(
        gte(meetings.occurredAt, new Date(from.getTime() - MEETING_MATCH_TOLERANCE_MS)),
        lte(meetings.occurredAt, to),
      ),
    );
}

/**
 * Évalue tous les rendez-vous en cache d'un utilisateur, sans rien écrire.
 * C'est ce qu'on rejoue à blanc avant de toucher aux poids.
 */
export async function evaluateCalendarEvents(
  conn: Database,
  userId: string,
  now: Date = new Date(),
): Promise<CalendarEvaluation[]> {
  const events = await userEvents(conn, userId);
  if (events.length === 0) return [];

  const parsed = events.map((e) => ({ ...e, attendeeList: parseAttendees(e.attendees) }));
  const [open, domains, team] = await Promise.all([
    openProjects(conn),
    entityDomains(conn),
    teamEmails(conn),
  ]);
  const openIds = new Set(open.map((p) => p.id));

  const externals = new Map(
    parsed.map((e) => [e.id, externalAttendees(e.attendeeList, team)] as const),
  );
  const emails = [...new Set([...externals.values()].flat().map((a) => a.email))];
  const contactOf = await contactsByEmail(conn, emails);
  const projectsOf = await projectsOfContacts(conn, [...new Set(contactOf.values())], openIds);

  const minStart = new Date(Math.min(...parsed.map((e) => e.startAt.getTime())));
  const maxEnd = new Date(Math.max(...parsed.map((e) => e.endAt.getTime())));
  const nearby = await meetingsAround(conn, minStart, maxEnd);

  return parsed.map((e) => {
    const ext = externals.get(e.id) ?? [];
    const contactIds = [
      ...new Set(ext.map((a) => contactOf.get(a.email)).filter((id): id is string => !!id)),
    ];
    // Un événement « journée entière » (jour férié, absence) couvre toute
    // réunion du jour et n'est jamais du temps : ni indices, ni réunion appariée.
    const meeting = e.allDay ? null : matchMeeting(e, nearby);
    const signals: CalendarSignal[] = e.allDay
      ? []
      : [
          ...calendarTitleSignals(e.summary, open),
          ...attendeeSignals(contactIds.map((id) => [...(projectsOf.get(id) ?? [])])),
          ...domainSignals(ext, domains, open),
          ...meetingSignal(meeting && openIds.has(meeting.projectId ?? "") ? meeting : null),
        ];
    const decision = decideCalendarProject(signals);
    return {
      calendarEventId: e.id,
      googleCalendarId: e.googleCalendarId,
      googleEventId: e.googleEventId,
      summary: e.summary,
      startAt: e.startAt,
      endAt: e.endAt,
      decision,
      signals,
      ineligible: eventIneligibility({ ...e, attendees: e.attendeeList }),
      ended: hasEnded(e, now),
      meetingId: meeting?.id ?? null,
      meetingNeedsProject: !!meeting && !meeting.projectId && !meeting.projectAutoAt,
      contactId: contactIds.length === 1 ? (contactIds[0] ?? null) : null,
    };
  });
}

export type AttachCalendarResult = {
  checked: number;
  suggested: number;
  /** Créneaux posés sans clic pendant ce passage. */
  applied: number;
  meetingsAttached: number;
};

const eventKey = (calendarId: string, eventId: string) => `${calendarId}|${eventId}`;

/**
 * Évalue et écrit : liens, créneaux sans clic, projets des réunions. Les
 * rendez-vous déjà tranchés (créneau en place, refus) ne sont pas revus.
 */
export async function attachCalendarEvents(
  conn: Database,
  userId: string,
  opts: { autoTime: boolean; now?: Date },
): Promise<AttachCalendarResult> {
  const now = opts.now ?? new Date();
  const result: AttachCalendarResult = {
    checked: 0,
    suggested: 0,
    applied: 0,
    meetingsAttached: 0,
  };
  const evaluations = await evaluateCalendarEvents(conn, userId, now);
  if (evaluations.length === 0) return result;

  const calendarIds = [...new Set(evaluations.map((e) => e.googleCalendarId))];
  const [links, mirrored] = await Promise.all([
    conn
      .select({
        googleCalendarId: calendarEventLinks.googleCalendarId,
        googleEventId: calendarEventLinks.googleEventId,
        status: calendarEventLinks.status,
        timeEntryId: calendarEventLinks.timeEntryId,
        entryStillThere: timeEntries.id,
      })
      .from(calendarEventLinks)
      .leftJoin(timeEntries, eq(timeEntries.id, calendarEventLinks.timeEntryId))
      .where(
        and(
          eq(calendarEventLinks.userId, userId),
          inArray(calendarEventLinks.googleCalendarId, calendarIds),
        ),
      ),
    conn
      .select({
        id: timeEntries.id,
        googleCalendarId: timeEntries.googleCalendarId,
        googleEventId: timeEntries.googleEventId,
        projectId: timeEntries.projectId,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, userId),
          isNotNull(timeEntries.googleEventId),
          inArray(timeEntries.googleCalendarId, calendarIds),
        ),
      ),
  ]);
  const linkByKey = new Map(links.map((l) => [eventKey(l.googleCalendarId, l.googleEventId), l]));
  const entryByKey = new Map(
    mirrored.flatMap((m) =>
      m.googleCalendarId && m.googleEventId
        ? [[eventKey(m.googleCalendarId, m.googleEventId), m] as const]
        : [],
    ),
  );

  // Les rendez-vous où l'extraction d'une réunion pourrait se tromper ne sont
  // qu'un sous-ensemble : on ne rattache une réunion qu'une fois par passage.
  const attachedMeetings = new Set<string>();

  for (const ev of evaluations) {
    const key = eventKey(ev.googleCalendarId, ev.googleEventId);
    const link = linkByKey.get(key);
    if (link?.status === "dismissed") continue;
    if (link?.status === "applied") {
      if (link.entryStillThere) continue;
      // Le créneau a disparu sans passer par nos actions : c'est un refus.
      await upsertLink(conn, ev, userId, {
        status: "dismissed",
        timeEntryId: null,
        autoAt: null,
        checkedAt: now,
      });
      continue;
    }
    result.checked++;

    // Attribué à la main avant que ce module existe : on en prend acte.
    const manual = entryByKey.get(key);
    if (manual) {
      await upsertLink(conn, ev, userId, {
        status: "applied",
        projectId: manual.projectId,
        meetingId: ev.meetingId,
        score: null,
        reasons: "manual",
        timeEntryId: manual.id,
        autoAt: null,
        checkedAt: now,
      });
      continue;
    }

    if (!ev.decision) {
      await upsertLink(conn, ev, userId, {
        status: "unmatched",
        projectId: null,
        meetingId: ev.meetingId,
        score: null,
        reasons: null,
        checkedAt: now,
      });
      continue;
    }

    if (ev.meetingId && ev.meetingNeedsProject && !attachedMeetings.has(ev.meetingId)) {
      await conn
        .update(meetings)
        .set({
          projectId: ev.decision.projectId,
          projectAutoAt: now,
          projectAutoReason: `calendar:${describeDecision(ev.decision)}`,
          projectAutoCheckedAt: now,
        })
        .where(and(eq(meetings.id, ev.meetingId), sql`${meetings.projectId} is null`));
      attachedMeetings.add(ev.meetingId);
      result.meetingsAttached++;
    }

    const canApply = opts.autoTime && ev.ended && ev.ineligible === null;
    if (!canApply) {
      result.suggested++;
      await upsertLink(conn, ev, userId, {
        status: "suggested",
        projectId: ev.decision.projectId,
        meetingId: ev.meetingId,
        score: String(ev.decision.score),
        reasons: describeDecision(ev.decision),
        checkedAt: now,
      });
      continue;
    }

    const [event] = await conn
      .select({ summary: calendarEvents.summary, description: calendarEvents.description })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, ev.calendarEventId))
      .limit(1);
    const [entry] = await conn
      .insert(timeEntries)
      .values({
        userId,
        kind: "actual",
        startAt: ev.startAt,
        endAt: ev.endAt,
        title: event?.summary ?? ev.summary ?? "Sans titre",
        description: event?.description ?? null,
        projectId: ev.decision.projectId,
        contactId: ev.contactId,
        googleEventId: ev.googleEventId,
        googleCalendarId: ev.googleCalendarId,
        source: "calendar",
      })
      .returning({ id: timeEntries.id });
    result.applied++;
    await upsertLink(conn, ev, userId, {
      status: "applied",
      projectId: ev.decision.projectId,
      meetingId: ev.meetingId,
      score: String(ev.decision.score),
      reasons: describeDecision(ev.decision),
      timeEntryId: entry?.id ?? null,
      autoAt: now,
      checkedAt: now,
    });
  }
  return result;
}

type LinkPatch = Partial<{
  status: "suggested" | "applied" | "dismissed" | "unmatched";
  projectId: string | null;
  meetingId: string | null;
  score: string | null;
  reasons: string | null;
  timeEntryId: string | null;
  autoAt: Date | null;
  checkedAt: Date;
}>;

async function upsertLink(
  conn: Database,
  ev: Pick<CalendarEvaluation, "googleCalendarId" | "googleEventId">,
  userId: string,
  patch: LinkPatch,
): Promise<void> {
  const set = { ...patch, updatedAt: new Date() };
  await conn
    .insert(calendarEventLinks)
    .values({
      userId,
      googleCalendarId: ev.googleCalendarId,
      googleEventId: ev.googleEventId,
      ...patch,
    })
    .onConflictDoUpdate({
      target: [calendarEventLinks.googleCalendarId, calendarEventLinks.googleEventId],
      set,
    });
}

/**
 * L'humain a posé lui-même le créneau de ce rendez-vous (dialogue de /temps) :
 * le lien devient `applied`, sans `auto_at`, et la relève ne le revoit plus.
 */
export async function recordManualCalendarLink(
  conn: Database,
  args: {
    userId: string;
    googleCalendarId: string;
    googleEventId: string;
    projectId: string | null;
    timeEntryId: string;
  },
): Promise<void> {
  await upsertLink(conn, args, args.userId, {
    status: "applied",
    projectId: args.projectId,
    score: null,
    reasons: "manual",
    timeEntryId: args.timeEntryId,
    autoAt: null,
    checkedAt: new Date(),
  });
}

/**
 * Le créneau miroir d'un rendez-vous est supprimé : le rendez-vous est
 * `dismissed`, on ne reposera jamais de créneau dessus d'office. À appeler
 * avant le delete (la FK met `time_entry_id` à null, on perdrait la trace).
 */
export async function dismissCalendarLinkForTimeEntry(
  conn: Database,
  timeEntryId: string,
): Promise<void> {
  const [entry] = await conn
    .select({
      userId: timeEntries.userId,
      googleCalendarId: timeEntries.googleCalendarId,
      googleEventId: timeEntries.googleEventId,
    })
    .from(timeEntries)
    .where(eq(timeEntries.id, timeEntryId))
    .limit(1);
  if (!entry?.googleCalendarId || !entry.googleEventId) return;
  await upsertLink(
    conn,
    { googleCalendarId: entry.googleCalendarId, googleEventId: entry.googleEventId },
    entry.userId,
    { status: "dismissed", timeEntryId: null, autoAt: null, checkedAt: new Date() },
  );
}
