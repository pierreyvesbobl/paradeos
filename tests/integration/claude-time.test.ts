import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import { addProjectRepo, removeProjectRepo } from "@/lib/actions/project-repos";
import { getGlobalTimeStats, getProjectTimeStats } from "@/lib/db/queries/time-stats";
import { linkRepo, resolveRepo, trackClaudeTime } from "../../mcp-server/tools/claude-time";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

// Les tools MCP ont leur propre client Drizzle : on le branche sur PGlite.
vi.mock("../../mcp-server/db", () => ({ db: () => db }));

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  actAs(actor);
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

async function seedProject(name: string, status: "active" | "archived" = "active") {
  const [row] = await db
    .insert(projects)
    .values({ name, kind: "client", status, billingType: "hourly", hourlyRate: "100" })
    .returning({ id: projects.id });
  if (!row) throw new Error("seed project");
  return row.id;
}

const ctx = () => ({ userId: actor.id, source: "token" as const });
const at = (h: number, min = 0) => new Date(Date.UTC(2026, 9, 12, h, min)).toISOString();

describe("dépôts git ↔ projets", () => {
  it("normalise le remote et déplace un dépôt déjà pris", async () => {
    const a = await seedProject("Autoradio");
    const b = await seedProject("Autoradio v2");

    const added = await addProjectRepo({
      projectId: a,
      remote: "git@github.com:parade/autoradio.git",
    });
    expect(added.ok).toBe(true);
    expect(added.ok && added.data?.remote).toBe("github.com/parade/autoradio");

    const moved = await addProjectRepo({
      projectId: b,
      remote: "https://github.com/Parade/Autoradio",
    });
    expect(moved.ok).toBe(true);
    const rows = await db
      .select({ projectId: projectRepos.projectId })
      .from(projectRepos)
      .where(eq(projectRepos.remote, "github.com/parade/autoradio"));
    expect(rows).toEqual([{ projectId: b }]);

    const bad = await addProjectRepo({ projectId: a, remote: "/Users/py/Dev/autoradio" });
    expect(bad.ok).toBe(false);

    const id = (await db.select({ id: projectRepos.id }).from(projectRepos))[0]?.id ?? "";
    expect((await removeProjectRepo({ id })).ok).toBe(true);
    expect(await db.select().from(projectRepos)).toHaveLength(0);
  });

  it("resolve_repo renvoie le projet lié, sinon des candidats par affinité de nom", async () => {
    const thermigo = await seedProject("Thermigo");
    await seedProject("Vieux projet", "archived");

    const unknown = await resolveRepo({ remote: "git@github.com:parade/thermigo-landing.git" });
    expect(unknown.linked).toBe(false);
    expect(unknown.remote).toBe("github.com/parade/thermigo-landing");
    expect(unknown.candidates[0]?.id).toBe(thermigo);
    expect(unknown.candidates.map((c) => c.name)).not.toContain("Vieux projet");

    const linked = await linkRepo(
      { remote: "https://github.com/parade/thermigo-landing.git", projectName: "thermigo" },
      ctx(),
    );
    expect(linked.project?.id).toBe(thermigo);

    const again = await resolveRepo({ remote: "ssh://git@github.com/parade/thermigo-landing" });
    expect(again.linked).toBe(true);
    expect(again.project?.id).toBe(thermigo);

    expect(await resolveRepo({ remote: "/tmp/local" })).toMatchObject({
      remote: null,
      linked: false,
    });
  });
});

describe("track_claude_time", () => {
  it("réécrit le même segment et partage les minutes entre sessions parallèles", async () => {
    const x = await seedProject("Projet X");
    const y = await seedProject("Projet Y");

    const first = await trackClaudeTime(
      { sourceRef: "s1:1", startAt: at(10), endAt: at(10, 30), projectId: x },
      ctx(),
    );
    const extended = await trackClaudeTime(
      { sourceRef: "s1:1", startAt: at(10), endAt: at(11), projectId: x },
      ctx(),
    );
    expect(extended?.id).toBe(first?.id);

    const mine = await db
      .select({ source: timeEntries.source, kind: timeEntries.kind })
      .from(timeEntries)
      .where(eq(timeEntries.sourceRef, "s1:1"));
    expect(mine).toEqual([{ source: "claude_code", kind: "actual" }]);

    // Deuxième session, 10h30 → 11h30 sur Y : 30 min communes partagées.
    await trackClaudeTime(
      { sourceRef: "s2:1", startAt: at(10, 30), endAt: at(11, 30), projectId: y },
      ctx(),
    );

    const stats = await getGlobalTimeStats(new Date(at(0)), new Date(at(23)));
    const minutesOf = (id: string) =>
      stats.byProject.find((p) => p.projectId === id)?.actualMinutes ?? 0;
    expect(minutesOf(x)).toBe(45);
    expect(minutesOf(y)).toBe(45);
    expect(stats.bySource.claude_code).toBe(90);
    expect(stats.totals.actualMinutes).toBe(90);

    const px = await getProjectTimeStats(x);
    expect(px.totals.actualMinutes).toBe(45);
    expect(px.claudeMinutes).toBe(45);

    await expect(
      trackClaudeTime({ sourceRef: "s3:1", startAt: at(12), endAt: at(11) }, ctx()),
    ).rejects.toThrow(/endAt/);
  });
});
