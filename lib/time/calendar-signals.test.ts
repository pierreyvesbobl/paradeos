import { describe, expect, it } from "vitest";
import {
  attendeeSignals,
  decideCalendarProject,
  domainSignals,
  emailDomain,
  eventIneligibility,
  externalAttendees,
  matchMeeting,
  parseAttendees,
  websiteDomain,
} from "./calendar-signals";

const at = (h: number, min = 0) => new Date(Date.UTC(2026, 10, 12, h, min));
const gpas = {
  id: "gpas",
  name: "GpasPlus - Automatisation",
  entityId: "e-gpas",
  entityName: "GpasPlus",
};
const gpas2 = {
  id: "gpas2",
  name: "GpasPlus - Qualité",
  entityId: "e-gpas",
  entityName: "GpasPlus",
};
const geek = {
  id: "geek",
  name: "The Geek Family - IA",
  entityId: "e-geek",
  entityName: "The Geek Family",
};

describe("parseAttendees / externalAttendees", () => {
  it("normalise les invités et écarte soi, les salles et l'équipe", () => {
    const attendees = parseAttendees([
      { self: true, email: "PY@bobl.fr", responseStatus: "accepted" },
      { email: "benoit@bobl.fr", organizer: true },
      { email: "salle@resource.calendar.google.com", resource: true },
      { email: "client@gpasplus.com", responseStatus: "needsAction" },
      { displayName: "sans adresse" },
      null,
    ]);
    expect(attendees).toHaveLength(4);
    expect(attendees[0]).toMatchObject({ email: "py@bobl.fr", self: true });
    expect(externalAttendees(attendees, new Set(["benoit@bobl.fr"])).map((a) => a.email)).toEqual([
      "client@gpasplus.com",
    ]);
  });
});

describe("eventIneligibility", () => {
  const base = { allDay: false, status: "confirmed", startAt: at(9), endAt: at(10), attendees: [] };
  it("un bloc posé seul, sans invité, compte", () => {
    expect(eventIneligibility(base)).toBeNull();
  });
  it("journée entière, annulé, trop long, trop court", () => {
    expect(eventIneligibility({ ...base, allDay: true })).toBe("all_day");
    expect(eventIneligibility({ ...base, status: "cancelled" })).toBe("cancelled");
    expect(eventIneligibility({ ...base, endAt: at(18, 1) })).toBe("too_long");
    expect(eventIneligibility({ ...base, endAt: at(9, 4) })).toBe("too_short");
  });
  it("avec invités, il faut avoir accepté ou organiser", () => {
    const self = (responseStatus: string, organizer = false) =>
      parseAttendees([{ self: true, email: "me@bobl.fr", responseStatus, organizer }]);
    expect(eventIneligibility({ ...base, attendees: self("declined") })).toBe("declined");
    expect(eventIneligibility({ ...base, attendees: self("needsAction") })).toBe("not_confirmed");
    expect(eventIneligibility({ ...base, attendees: self("tentative") })).toBe("not_confirmed");
    expect(eventIneligibility({ ...base, attendees: self("accepted") })).toBeNull();
    expect(eventIneligibility({ ...base, attendees: self("needsAction", true) })).toBeNull();
  });
});

describe("attendeeSignals", () => {
  it("tous les contacts invités désignent le même projet : il l'emporte", () => {
    expect(attendeeSignals([["gpas"], ["gpas", "geek"]])).toEqual([
      { projectId: "gpas", kind: "attendees", weight: 0.8 },
    ]);
    expect(decideCalendarProject(attendeeSignals([["gpas"]]))?.projectId).toBe("gpas");
  });
  it("sans projet commun, le poids se répartit et ne suffit pas", () => {
    const s = attendeeSignals([["gpas"], ["geek"]]);
    expect(s.map((x) => x.weight)).toEqual([0.25, 0.25]);
    expect(s.every((x) => x.kind === "client")).toBe(true);
    expect(decideCalendarProject(s)).toBeNull();
  });
  it("un client à deux projets ne tranche pas seul", () => {
    expect(decideCalendarProject(attendeeSignals([["gpas", "gpas2"]]))).toBeNull();
    expect(attendeeSignals([[], []])).toEqual([]);
  });
});

describe("domaines", () => {
  it("ignore les boîtes grand public et lit le domaine d'un site", () => {
    expect(emailDomain("x@gmail.com")).toBeNull();
    expect(emailDomain("x@GpasPlus.com")).toBe("gpasplus.com");
    expect(websiteDomain("https://www.gpasplus.com/fr/")).toBe("gpasplus.com");
    expect(websiteDomain("gpasplus.com")).toBe("gpasplus.com");
    expect(websiteDomain("n'importe quoi")).toBeNull();
    expect(websiteDomain(null)).toBeNull();
  });
  it("le domaine d'un invité désigne les projets du client", () => {
    const attendees = parseAttendees([{ email: "a@gpasplus.com" }, { email: "b@gmail.com" }]);
    const domains = [{ entityId: "e-gpas", domain: "gpasplus.com" }];
    expect(domainSignals(attendees, domains, [gpas, geek])).toEqual([
      { projectId: "gpas", kind: "client", weight: 0.6 },
    ]);
    expect(domainSignals(attendees, domains, [gpas, gpas2]).map((s) => s.weight)).toEqual([
      0.25, 0.25,
    ]);
    expect(domainSignals(attendees, [], [gpas])).toEqual([]);
  });
});

describe("matchMeeting", () => {
  const ev = { startAt: at(9), endAt: at(10) };
  it("la réunion tenue sur le créneau, la plus proche du début", () => {
    const early = { id: "early", occurredAt: at(8, 50), projectId: null };
    const late = { id: "late", occurredAt: at(9, 30), projectId: null };
    const other = { id: "other", occurredAt: at(14), projectId: null };
    const before = { id: "before", occurredAt: at(8, 30), projectId: null };
    expect(matchMeeting(ev, [other, late, early, before])?.id).toBe("early");
    expect(matchMeeting(ev, [other, before])).toBeNull();
    expect(matchMeeting(ev, [{ id: "nodate", occurredAt: null, projectId: null }])).toBeNull();
  });
});

describe("decideCalendarProject", () => {
  it("un titre de client et un invité du même client : rattaché", () => {
    const d = decideCalendarProject([
      { projectId: "gpas", kind: "client", weight: 0.6 },
      { projectId: "gpas", kind: "attendees", weight: 0.8 },
    ]);
    expect(d).toEqual({ projectId: "gpas", score: 1.4, reasons: ["client", "attendees"] });
  });
  it("chez un client à deux projets, les indices client ne s'additionnent pas sur le rival", () => {
    // Titre du client, domaine et invité multi-projets : trois fois 0,25 sur
    // chaque projet, mais un seul indice `client` retenu, le nom du projet tranche.
    const d = decideCalendarProject([
      { projectId: "gpas2", kind: "title_project", weight: 0.8 },
      ...(["gpas", "gpas2"] as const).flatMap((projectId) => [
        { projectId, kind: "client" as const, weight: 0.25 },
        { projectId, kind: "client" as const, weight: 0.25 },
        { projectId, kind: "client" as const, weight: 0.25 },
      ]),
    ]);
    expect(d).toEqual({ projectId: "gpas2", score: 1.05, reasons: ["title_project", "client"] });
  });
  it("un rival au-dessus de 0,3 fait un rendez-vous transverse", () => {
    expect(
      decideCalendarProject([
        { projectId: "gpas", kind: "title_project", weight: 0.8 },
        { projectId: "geek", kind: "attendees", weight: 0.8 },
      ]),
    ).toBeNull();
  });
});
