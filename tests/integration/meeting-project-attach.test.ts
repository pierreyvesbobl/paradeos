import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { entities } from "@/db/schema/entities";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { attachMeetingIfConfident, backfillMeetingProjects } from "@/lib/meetings/project-attach";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Une réunion sans projet se rattache seule quand les indices concordent,
 * reste sans projet quand ils divergent, et une réunion détachée à la main
 * n'est jamais rattachée de nouveau.
 */

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let gpasId: string;
let geekId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  actAs(actor);
  const [gpas, geek] = await db
    .insert(entities)
    .values([
      { name: "GpasPlus", kind: "client" },
      { name: "The Geek Family", kind: "client" },
    ])
    .returning({ id: entities.id });
  if (!gpas || !geek) throw new Error("insert entities");
  const [p1, p2] = await db
    .insert(projects)
    .values([
      { name: "GpasPlus - Automatisation", kind: "client", status: "active", entityId: gpas.id },
      {
        name: "The Geek Family - Partenariat IA",
        kind: "client",
        status: "active",
        entityId: geek.id,
      },
    ])
    .returning({ id: projects.id });
  if (!p1 || !p2) throw new Error("insert projects");
  gpasId = p1.id;
  geekId = p2.id;
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

async function meeting(title: string, taskProjects: string[] = []) {
  const [m] = await db
    .insert(meetings)
    .values({ title, transcript: "…", status: "extracted", createdBy: actor.id })
    .returning({ id: meetings.id });
  if (!m) throw new Error("insert meeting");
  if (taskProjects.length > 0) {
    await db.insert(meetingProposals).values(
      taskProjects.map((projectId, i) => ({
        meetingId: m.id,
        kind: "task" as const,
        payload: { title: `Tâche ${i}`, projectId },
      })),
    );
  }
  return m.id;
}

const projectOf = async (id: string) =>
  (
    await db
      .select({ p: meetings.projectId, r: meetings.projectAutoReason })
      .from(meetings)
      .where(eq(meetings.id, id))
  )[0];

describe("rattachement automatique", () => {
  it("rattache quand le titre et les tâches concordent, et trace pourquoi", async () => {
    const id = await meeting("Point GpasPlus", [gpasId, gpasId, gpasId]);
    const d = await attachMeetingIfConfident(db, id);
    expect(d?.projectId).toBe(gpasId);
    const row = await projectOf(id);
    expect(row?.p).toBe(gpasId);
    expect(row?.r).toContain("title_entity");
  });

  it("laisse sans projet une réunion aux indices dispersés", async () => {
    const id = await meeting("Point associés", [gpasId, geekId, gpasId, geekId]);
    expect(await attachMeetingIfConfident(db, id)).toBeNull();
    expect((await projectOf(id))?.p).toBeNull();
  });

  it("garde la reconnaissance du transcript comme indice suffisant", async () => {
    const id = await meeting("Réunion du 12");
    expect((await attachMeetingIfConfident(db, id, { namedProjectIds: [geekId] }))?.projectId).toBe(
      geekId,
    );
  });

  it("ne rattache plus une réunion détachée à la main", async () => {
    const id = await meeting("R1 The Geek Family - Partenariat IA");
    await backfillMeetingProjects(db);
    expect((await projectOf(id))?.p).toBe(geekId);
    await db.update(meetings).set({ projectId: null }).where(eq(meetings.id, id));
    await backfillMeetingProjects(db, { now: new Date(Date.now() + 2 * 86_400_000) });
    expect((await projectOf(id))?.p).toBeNull();
  });
});
