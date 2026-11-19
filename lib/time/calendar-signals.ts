import { normalizeEmail } from "@/lib/crm/name-key";
import {
  decideProject,
  type NamedProject,
  type ProjectDecision,
  type ProjectSignal,
  SIGNAL_WEIGHT,
  titleSignals,
} from "@/lib/meetings/project-signals";

/**
 * Rattachement d'un rendez-vous Google Calendar à un projet, et règles qui
 * disent si ce rendez-vous vaut du temps réalisé. Règles pures ; la
 * collecte en base vit dans calendar-attach.ts.
 *
 * Même logique que les réunions (lib/meetings/project-signals.ts) : chaque
 * indice pèse, on rattache dès 0,8 si aucun autre projet ne dépasse 0,3.
 * Les invités d'un rendez-vous sont un indice plus sûr que les personnes
 * citées dans un transcript : quand tous les contacts invités désignent le
 * même projet, cela suffit.
 */

export type CalendarSignalKind =
  /** Le titre contient le nom du projet. */
  | "title_project"
  /** Tous les contacts invités sont rattachés à ce seul projet. */
  | "attendees"
  /**
   * Le rendez-vous désigne un client, pas un projet : son nom dans le titre,
   * le domaine e-mail des invités, des invités rattachés à plusieurs de ses
   * projets. Trois sources, un seul indice : elles disent la même chose, et
   * seule la plus forte compte, sinon un client à deux projets verrait le
   * projet rival dépasser le seuil par simple accumulation.
   */
  | "client"
  /** Une réunion Parade OS (transcript) tenue sur ce créneau porte ce projet. */
  | "meeting";

export type CalendarSignal = ProjectSignal<CalendarSignalKind>;
export type CalendarDecision = ProjectDecision<CalendarSignalKind>;

export const CALENDAR_SIGNAL_WEIGHT = {
  /** Tous les contacts invités désignent un seul et même projet. */
  attendees_unanimous: 0.8,
  /** Sinon, réparti entre les projets qu'ils désignent. */
  attendees: 0.5,
  domain_sole: SIGNAL_WEIGHT.title_sole_entity,
  domain: SIGNAL_WEIGHT.title_entity,
  meeting: 0.8,
} as const;

/** Un rendez-vous plus long qu'une journée de travail n'est pas une réunion. */
export const MAX_EVENT_MINUTES = 8 * 60;
/** En dessous, c'est un rappel, pas un créneau. */
export const MIN_EVENT_MINUTES = 5;
/** Tolérance entre le début du rendez-vous et l'heure d'une réunion Parade OS. */
export const MEETING_MATCH_TOLERANCE_MS = 20 * 60_000;

export type CalendarAttendee = {
  email: string;
  self: boolean;
  organizer: boolean;
  resource: boolean;
  responseStatus: string | null;
};

/** Les invités tels que Google les stocke (jsonb brut), normalisés. */
export function parseAttendees(raw: unknown): CalendarAttendee[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarAttendee[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const email = normalizeEmail(typeof r.email === "string" ? r.email : null);
    if (!email) continue;
    out.push({
      email,
      self: r.self === true,
      organizer: r.organizer === true,
      resource: r.resource === true,
      responseStatus: typeof r.responseStatus === "string" ? r.responseStatus : null,
    });
  }
  return out;
}

export type EventForRules = {
  allDay: boolean;
  status: string | null;
  startAt: Date;
  endAt: Date;
  attendees: CalendarAttendee[];
};

export type Ineligibility =
  | "all_day"
  | "cancelled"
  | "too_long"
  | "too_short"
  | "declined"
  | "not_confirmed";

/**
 * Ce rendez-vous peut-il devenir un créneau réalisé ? Sans invités, c'est
 * un bloc que l'utilisateur s'est posé lui-même : oui. Avec invités, il
 * faut qu'il ait accepté (ou qu'il organise) : un « peut-être » ou une
 * invitation restée sans réponse ne compte pas.
 */
export function eventIneligibility(ev: EventForRules): Ineligibility | null {
  if (ev.allDay) return "all_day";
  if (ev.status === "cancelled") return "cancelled";
  const minutes = (ev.endAt.getTime() - ev.startAt.getTime()) / 60_000;
  if (minutes > MAX_EVENT_MINUTES) return "too_long";
  if (minutes < MIN_EVENT_MINUTES) return "too_short";
  const self = ev.attendees.find((a) => a.self);
  if (!self) return null;
  if (self.responseStatus === "declined") return "declined";
  if (self.organizer || self.responseStatus === "accepted") return null;
  return "not_confirmed";
}

/** Le rendez-vous est passé : on peut poser du réalisé. */
export function hasEnded(ev: Pick<EventForRules, "endAt">, now: Date): boolean {
  return ev.endAt.getTime() <= now.getTime();
}

/** Invités hors équipe (ni soi, ni salle, ni adresse d'un membre). */
export function externalAttendees(
  attendees: readonly CalendarAttendee[],
  teamEmails: ReadonlySet<string>,
): CalendarAttendee[] {
  return attendees.filter((a) => !a.self && !a.resource && !teamEmails.has(a.email));
}

/**
 * Projets des contacts invités. Si tous ceux qui ont un projet en désignent
 * un seul en commun, il l'emporte ; sinon le poids se répartit entre les
 * projets de l'union.
 */
export function attendeeSignals(projectIdsOfAttendees: string[][]): CalendarSignal[] {
  const sets = projectIdsOfAttendees.map((ids) => new Set(ids)).filter((s) => s.size > 0);
  if (sets.length === 0) return [];
  const first = sets[0];
  if (!first) return [];
  const common = [...first].filter((id) => sets.every((s) => s.has(id)));
  if (common.length === 1 && common[0]) {
    return [
      {
        projectId: common[0],
        kind: "attendees",
        weight: CALENDAR_SIGNAL_WEIGHT.attendees_unanimous,
      },
    ];
  }
  const all = new Set(sets.flatMap((s) => [...s]));
  const share = CALENDAR_SIGNAL_WEIGHT.attendees / all.size;
  return [...all].map((projectId) => ({ projectId, kind: "client" as const, weight: share }));
}

/** Boîtes grand public : un domaine qui ne désigne personne. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "mac.com",
  "free.fr",
  "orange.fr",
  "wanadoo.fr",
  "sfr.fr",
  "laposte.net",
  "bbox.fr",
  "numericable.fr",
  "protonmail.com",
  "proton.me",
  "pm.me",
]);

/** Domaine d'une adresse, ou null pour une boîte grand public. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const domain = email
    .slice(at + 1)
    .toLowerCase()
    .trim();
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/** Domaine d'un site web (`https://www.gpasplus.com/fr` → `gpasplus.com`). */
export function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export type EntityDomain = { entityId: string; domain: string };

/**
 * Les invités écrivent depuis le domaine d'un client : ses projets ouverts
 * gagnent le poids d'un client nommé dans le titre. Un seul projet : 0,6 ;
 * plusieurs : 0,5 réparti.
 */
export function domainSignals(
  attendees: readonly CalendarAttendee[],
  entityDomains: readonly EntityDomain[],
  openProjects: readonly NamedProject[],
): CalendarSignal[] {
  const domains = new Set(
    attendees.map((a) => emailDomain(a.email)).filter((d): d is string => d !== null),
  );
  if (domains.size === 0) return [];
  const entityIds = new Set(
    entityDomains.filter((e) => domains.has(e.domain)).map((e) => e.entityId),
  );
  if (entityIds.size === 0) return [];
  const out: CalendarSignal[] = [];
  for (const entityId of entityIds) {
    const own = openProjects.filter((p) => p.entityId === entityId);
    if (own.length === 0) continue;
    const share =
      own.length === 1
        ? CALENDAR_SIGNAL_WEIGHT.domain_sole
        : CALENDAR_SIGNAL_WEIGHT.domain / own.length;
    for (const p of own) out.push({ projectId: p.id, kind: "client", weight: share });
  }
  return out;
}

export type MeetingForMatch = {
  id: string;
  occurredAt: Date | null;
  projectId: string | null;
};

/**
 * La réunion Parade OS tenue sur ce créneau : celle dont l'heure tombe dans
 * le rendez-vous (avec tolérance avant le début, le transcript Meet date du
 * lancement de l'enregistrement). Plusieurs candidates : la plus proche du
 * début.
 */
export function matchMeeting<M extends MeetingForMatch>(
  ev: Pick<EventForRules, "startAt" | "endAt">,
  meetings: readonly M[],
): M | null {
  const start = ev.startAt.getTime();
  const end = ev.endAt.getTime();
  let best: { meeting: M; distance: number } | null = null;
  for (const m of meetings) {
    if (!m.occurredAt) continue;
    const t = m.occurredAt.getTime();
    if (t < start - MEETING_MATCH_TOLERANCE_MS || t > end) continue;
    const distance = Math.abs(t - start);
    if (!best || distance < best.distance) best = { meeting: m, distance };
  }
  return best?.meeting ?? null;
}

/** Les indices du titre : le nom du projet pèse seul, le nom du client vaut un indice `client`. */
export function calendarTitleSignals(
  title: string | null,
  openProjects: readonly NamedProject[],
): CalendarSignal[] {
  if (!title) return [];
  return titleSignals(title, [...openProjects]).flatMap((s): CalendarSignal[] => {
    if (s.kind === "title_project")
      return [{ projectId: s.projectId, kind: s.kind, weight: s.weight }];
    if (s.kind === "title_entity") {
      return [{ projectId: s.projectId, kind: "client" as const, weight: s.weight }];
    }
    return [];
  });
}

export function meetingSignal(meeting: MeetingForMatch | null): CalendarSignal[] {
  if (!meeting?.projectId) return [];
  return [
    { projectId: meeting.projectId, kind: "meeting", weight: CALENDAR_SIGNAL_WEIGHT.meeting },
  ];
}

export function decideCalendarProject(signals: CalendarSignal[]): CalendarDecision | null {
  return decideProject(signals);
}

/** Libellé de trace : `title_project+client (1.05)`. */
export function describeDecision(decision: CalendarDecision): string {
  return `${decision.reasons.join("+")} (${decision.score})`;
}
