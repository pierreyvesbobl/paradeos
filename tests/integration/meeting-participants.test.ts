import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { contacts } from "@/db/schema/contacts";
import { googleAccounts } from "@/db/schema/google-accounts";
import { meetingParticipants } from "@/db/schema/meeting-participants";
import { meetings } from "@/db/schema/meetings";
import { addMeetingParticipant } from "@/lib/actions/meeting-participants";
import { syncParticipantsFromAttendees } from "@/lib/meetings/participants";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Un membre de l'équipe qui a aussi une fiche contact homonyme (coworker,
 * import de carnet) ne doit figurer qu'une fois dans une réunion, sous son
 * compte : à l'extraction comme à l'ajout manuel.
 */

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let selfContactId: string;

async function createMeeting(title: string) {
  const [m] = await db
    .insert(meetings)
    .values({ title, transcript: "…", status: "extracted", createdBy: actor.id })
    .returning({ id: meetings.id });
  if (!m) throw new Error("insert meeting");
  return m.id;
}

async function rowsOf(meetingId: string) {
  return db
    .select({
      userId: meetingParticipants.userId,
      contactId: meetingParticipants.contactId,
      displayName: meetingParticipants.displayName,
      role: meetingParticipants.role,
    })
    .from(meetingParticipants)
    .where(eq(meetingParticipants.meetingId, meetingId));
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin", fullName: "Pierre-Yves Sage" });
  actAs(actor);
  await db.insert(googleAccounts).values({
    userId: actor.id,
    googleSub: "sub-1",
    email: "pierreyves@bobl.fr",
    accessTokenEnc: "x",
    refreshTokenEnc: "x",
    expiresAt: new Date(),
    scopes: [],
  });
  const [c] = await db
    .insert(contacts)
    .values({ firstName: "Pierre-Yves", lastName: "Sage", email: "pierreyves@bobl.fr" })
    .returning({ id: contacts.id });
  if (!c) throw new Error("insert contact");
  selfContactId = c.id;
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

describe("membre de l'équipe avec une fiche contact homonyme", () => {
  it("l'extraction le rattache à son compte, pas à la fiche, même avec le mail de la fiche", async () => {
    const meetingId = await createMeeting("Demo");
    await syncParticipantsFromAttendees(meetingId, [
      { name: "Pierre-Yves Sage", email: "pierreyves@bobl.fr", role: "Co-fondateur" },
      { name: "Jean Isnard", email: null, role: "Consultant" },
    ]);
    const rows = await rowsOf(meetingId);
    expect(rows).toHaveLength(2);
    const me = rows.find((r) => r.userId === actor.id);
    expect(me).toBeDefined();
    expect(me?.contactId).toBeNull();
    expect(me?.role).toBe("Co-fondateur");
    expect(rows.some((r) => r.contactId === selfContactId)).toBe(false);
    expect(rows.find((r) => r.displayName === "Jean Isnard")).toBeDefined();
  });

  it("le nom seul suffit quand il est net", async () => {
    const meetingId = await createMeeting("Point");
    await syncParticipantsFromAttendees(meetingId, [
      { name: "Pierre-Yves Sage", email: null, role: null },
    ]);
    const rows = await rowsOf(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(actor.id);
  });

  it("une ligne contact héritée est requalifiée en membre à la ré-extraction", async () => {
    const meetingId = await createMeeting("Héritée");
    await db.insert(meetingParticipants).values({
      meetingId,
      contactId: selfContactId,
      role: "Co-fondateur",
      source: "extraction",
    });
    await syncParticipantsFromAttendees(meetingId, [
      { name: "Pierre-Yves Sage", email: "pierreyves@bobl.fr", role: null },
    ]);
    const rows = await rowsOf(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(actor.id);
    expect(rows[0]?.contactId).toBeNull();
    expect(rows[0]?.role).toBe("Co-fondateur");
  });

  it("l'ajout manuel du membre remplace sa fiche contact déjà présente", async () => {
    const meetingId = await createMeeting("Manuel");
    await db.insert(meetingParticipants).values({
      meetingId,
      contactId: selfContactId,
      source: "extraction",
    });
    const res = await addMeetingParticipant({ meetingId, userId: actor.id });
    expect(res.ok).toBe(true);
    const rows = await rowsOf(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(actor.id);
  });

  it("l'ajout manuel de la fiche contact n'ajoute rien si le membre est déjà là", async () => {
    const meetingId = await createMeeting("Manuel inverse");
    await db.insert(meetingParticipants).values({ meetingId, userId: actor.id, source: "manual" });
    const res = await addMeetingParticipant({ meetingId, contactId: selfContactId });
    expect(res.ok).toBe(true);
    const rows = await rowsOf(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(actor.id);
  });
});
