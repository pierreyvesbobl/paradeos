import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { claudeCodeActivity } from "@/db/schema/claude-activity";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import { addProjectRepo, removeProjectRepo } from "@/lib/actions/project-repos";
import { createTimeEntry, deleteTimeEntry } from "@/lib/actions/time-entries";
import {
  getClaudeActivity,
  getClaudeBlocksForUser,
  getProjectClaudeActivity,
} from "@/lib/db/queries/claude-activity";
import { getGlobalTimeStats, getProjectTimeStats } from "@/lib/db/queries/time-stats";
import {
  linkRepo,
  listClaudeActivity,
  parisDayRange,
  resolveRepo,
  trackClaudeTime,
} from "../../mcp-server/tools/claude-time";
import { logTime } from "../../mcp-server/tools/tasks-time";
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

    // Deuxième session, 10h30 → 11h30 sur Y : 30 min communes partagées.
    await trackClaudeTime(
      { sourceRef: "s2:1", startAt: at(10, 30), endAt: at(11, 30), projectId: y },
      ctx(),
    );

    const activity = await getClaudeActivity(new Date(at(0)), new Date(at(23)));
    const minutesOf = (id: string) =>
      activity.byProject.find((p) => p.projectId === id)?.minutes ?? 0;
    expect(minutesOf(x)).toBe(45);
    expect(minutesOf(y)).toBe(45);
    expect(activity.totalMinutes).toBe(90);
    expect(await getProjectClaudeActivity(x)).toBe(45);

    await expect(
      trackClaudeTime({ sourceRef: "s3:1", startAt: at(12), endAt: at(11) }, ctx()),
    ).rejects.toThrow(/endAt/);
  });

  it("n'écrit aucun créneau réalisé : le signal reste hors du temps compté", async () => {
    const z = await seedProject("Projet Z");
    await trackClaudeTime(
      { sourceRef: "s9:1", startAt: at(14), endAt: at(15), projectId: z },
      ctx(),
    );

    expect(await db.select().from(timeEntries)).toHaveLength(0);
    const stats = await getGlobalTimeStats(new Date(at(0)), new Date(at(23)));
    expect(stats.totals.actualMinutes).toBe(0);
    expect(stats.bySource).toEqual({ manual: 0, calendar: 0, claude_code: 0 });
    expect((await getProjectTimeStats(z)).totals.actualMinutes).toBe(0);
  });

  it("déduit le projet du dépôt rattaché, et le laisse vide sinon", async () => {
    const w = await seedProject("Webradio");
    await linkRepo({ remote: "git@github.com:parade/webradio.git", projectId: w }, ctx());

    await trackClaudeTime(
      {
        sourceRef: "s4:1",
        startAt: at(16),
        endAt: at(17),
        remote: "https://github.com/Parade/Webradio",
      },
      ctx(),
    );
    await trackClaudeTime(
      {
        sourceRef: "s5:1",
        startAt: at(18),
        endAt: at(19),
        remote: "git@github.com:parade/inconnu.git",
      },
      ctx(),
    );

    const rows = await db
      .select({
        sourceRef: claudeCodeActivity.sourceRef,
        projectId: claudeCodeActivity.projectId,
        remote: claudeCodeActivity.remote,
      })
      .from(claudeCodeActivity)
      .where(eq(claudeCodeActivity.userId, actor.id));
    const byRef = new Map(rows.map((r) => [r.sourceRef, r]));
    expect(byRef.get("s4:1")).toMatchObject({
      projectId: w,
      remote: "github.com/parade/webradio",
    });
    expect(byRef.get("s5:1")).toMatchObject({
      projectId: null,
      remote: "github.com/parade/inconnu",
    });

    const activity = await getClaudeActivity(new Date(at(16)), new Date(at(23)));
    const orphan = activity.byProject.find((p) => p.projectId === null);
    expect(orphan?.remotes).toEqual(["github.com/parade/inconnu"]);
  });

  it("rattache seul un dépôt dont un unique projet ouvert porte le nom, et impute le passé", async () => {
    const studio = await seedProject("Studio Chanson");
    await seedProject("Studio Chanson", "archived"); // fermé : pas candidat

    // Premier segment arrivé avant tout rattachement.
    await trackClaudeTime(
      {
        sourceRef: "s6:1",
        startAt: at(8),
        endAt: at(9),
        remote: "git@github.com:parade/studio-chanson.git",
      },
      ctx(),
    );
    const link = await db
      .select({ projectId: projectRepos.projectId, autoLinked: projectRepos.autoLinked })
      .from(projectRepos)
      .where(eq(projectRepos.remote, "github.com/parade/studio-chanson"));
    expect(link).toEqual([{ projectId: studio, autoLinked: true }]);

    const rows = await db
      .select({ projectId: claudeCodeActivity.projectId })
      .from(claudeCodeActivity)
      .where(eq(claudeCodeActivity.sourceRef, "s6:1"));
    expect(rows).toEqual([{ projectId: studio }]);
  });

  it("laisse le doute à l'humain quand deux projets se ressemblent", async () => {
    const a = await seedProject("Thermigo");
    await seedProject("Thermigo v2");

    await trackClaudeTime(
      {
        sourceRef: "s7:1",
        startAt: at(8),
        endAt: at(9),
        remote: "git@github.com:parade/thermigo.git",
      },
      ctx(),
    );
    expect(
      await db
        .select()
        .from(projectRepos)
        .where(eq(projectRepos.remote, "github.com/parade/thermigo")),
    ).toHaveLength(0);
    const orphan = await db
      .select({ projectId: claudeCodeActivity.projectId })
      .from(claudeCodeActivity)
      .where(eq(claudeCodeActivity.sourceRef, "s7:1"));
    expect(orphan).toEqual([{ projectId: null }]);

    // L'humain tranche depuis /temps : l'activité passée est imputée.
    const res = await addProjectRepo({ projectId: a, remote: "github.com/parade/thermigo" });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data?.backfilled).toBe(1);
    const fixed = await db
      .select({ projectId: claudeCodeActivity.projectId })
      .from(claudeCodeActivity)
      .where(eq(claudeCodeActivity.sourceRef, "s7:1"));
    expect(fixed).toEqual([{ projectId: a }]);
    const link = await db
      .select({ autoLinked: projectRepos.autoLinked })
      .from(projectRepos)
      .where(eq(projectRepos.remote, "github.com/parade/thermigo"));
    expect(link).toEqual([{ autoLinked: false }]);
  });
});

describe("imputation depuis /temps", () => {
  it("un dossier sans git tient lieu de dépôt, rattaché par son nom", async () => {
    const motion = await seedProject("Motion design Automato");
    await trackClaudeTime(
      {
        sourceRef: "s10:1",
        startAt: at(8),
        endAt: at(9),
        remote: null,
        workdir: "/Users/py/Dev/Motion-Design-Automato",
      },
      ctx(),
    );
    const rows = await db
      .select({ projectId: claudeCodeActivity.projectId, remote: claudeCodeActivity.remote })
      .from(claudeCodeActivity)
      .where(eq(claudeCodeActivity.sourceRef, "s10:1"));
    expect(rows).toEqual([{ projectId: motion, remote: "local/motion-design-automato" }]);
  });

  it("fusionne les segments contigus en un bloc, puis le bloc devient un créneau", async () => {
    const p = await seedProject("Projet Bloc");
    const day = (h: number, min = 0) => new Date(Date.UTC(2026, 9, 20, h, min));
    const push = (ref: string, s: Date, e: Date, projectId: string | null = p) =>
      trackClaudeTime(
        { sourceRef: ref, startAt: s.toISOString(), endAt: e.toISOString(), projectId },
        ctx(),
      );
    // Trois segments d'une même séance (plafond par tour, reprise), puis
    // une pause de 45 min, puis une autre séance ; et un dossier à part.
    await push("b1:1", day(9), day(9, 20));
    await push("b1:2", day(9, 25), day(9, 40));
    await push("b2:1", day(9, 35), day(10)); // session parallèle, même projet
    await push("b1:3", day(10, 45), day(11));
    await trackClaudeTime(
      {
        sourceRef: "b3:1",
        startAt: day(9, 30).toISOString(),
        endAt: day(9, 50).toISOString(),
        workdir: "maquettes",
      },
      ctx(),
    );

    const blocks = await getClaudeBlocksForUser(actor.id, day(0), day(23));
    expect(blocks.map((b) => [b.label, b.minutes, b.segmentIds.length])).toEqual([
      ["Projet Bloc", 55, 3],
      ["dossier maquettes", 20, 1],
      ["Projet Bloc", 15, 1],
    ]);
    const first = blocks[0];
    if (!first) throw new Error("bloc attendu");
    expect(first.startAt.toISOString()).toBe(day(9).toISOString());
    expect(first.endAt.toISOString()).toBe(day(10).toISOString());

    // Imputation : un créneau réalisé, les segments sortent de la grille.
    const created = await createTimeEntry({
      kind: "actual",
      startAt: first.startAt.toISOString(),
      endAt: first.endAt.toISOString(),
      title: "Projet Bloc",
      projectId: p,
      claudeSegmentIds: first.segmentIds,
    });
    expect(created.ok).toBe(true);
    const entryId = created.ok ? (created.data?.id ?? "") : "";
    const entry = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
    expect(entry[0]).toMatchObject({ source: "claude_code", sourceRef: "b1:1", projectId: p });

    const after = await getClaudeBlocksForUser(actor.id, day(0), day(23));
    expect(after.map((b) => b.label)).toEqual(["dossier maquettes", "Projet Bloc"]);

    const activity = await getClaudeActivity(day(0), day(23));
    const row = activity.byProject.find((r) => r.projectId === p);
    expect(row?.segments).toBe(4);
    expect(row?.imputedMinutes).toBeGreaterThan(0);
    expect(activity.imputedMinutes).toBe(row?.imputedMinutes);

    // Double clic ou second onglet : pas de second créneau.
    const again = await createTimeEntry({
      kind: "actual",
      startAt: first.startAt.toISOString(),
      endAt: first.endAt.toISOString(),
      claudeSegmentIds: first.segmentIds,
    });
    expect(again.ok).toBe(false);

    // Supprimer le créneau rend le bloc à la grille.
    expect((await deleteTimeEntry({ id: entryId })).ok).toBe(true);
    const back = await getClaudeBlocksForUser(actor.id, day(0), day(23));
    expect(back.map((b) => b.label)).toEqual(["Projet Bloc", "dossier maquettes", "Projet Bloc"]);
  });

  it("le MCP liste les blocs d'un jour de Paris et log_time les impute", async () => {
    const p = await seedProject("Projet Journée");
    // Le 2 novembre 2026 : heure d'hiver, Paris = UTC+1.
    const { start, end } = parisDayRange("2026-11-02");
    expect(start.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T23:00:00.000Z");
    // Le 15 juillet : heure d'été, UTC+2.
    expect(parisDayRange("2026-07-15").start.toISOString()).toBe("2026-07-14T22:00:00.000Z");

    const t = (h: number, min = 0) => new Date(Date.UTC(2026, 10, 2, h, min)).toISOString();
    await trackClaudeTime(
      { sourceRef: "j1:1", startAt: t(8), endAt: t(8, 40), projectId: p },
      ctx(),
    );
    await trackClaudeTime(
      { sourceRef: "j1:2", startAt: t(8, 50), endAt: t(9, 10), projectId: p },
      ctx(),
    );
    // 00:30 Paris le 3/11 = 23:30 UTC le 2/11 : hors de la journée du 2.
    await trackClaudeTime(
      { sourceRef: "j2:1", startAt: t(23, 30), endAt: t(23, 50), projectId: p },
      ctx(),
    );

    const day = await listClaudeActivity({ date: "2026-11-02" }, ctx());
    expect(day.blocks).toHaveLength(1);
    expect(day.totalMinutes).toBe(60);
    const block = day.blocks[0];
    if (!block) throw new Error("bloc attendu");
    expect(block).toMatchObject({ projectId: p, suggestedTitle: "Projet Journée", minutes: 60 });
    expect(block.segmentIds).toHaveLength(2);

    const logged = await logTime(
      {
        startAt: block.startAt,
        endAt: block.endAt,
        projectId: p,
        title: block.suggestedTitle,
        claudeSegmentIds: block.segmentIds,
      },
      ctx(),
    );
    expect(logged?.imputedSegments).toBe(2);
    const entry = await db
      .select({ source: timeEntries.source, sourceRef: timeEntries.sourceRef })
      .from(timeEntries)
      .where(eq(timeEntries.id, logged?.id ?? ""));
    expect(entry).toEqual([{ source: "claude_code", sourceRef: "j1:1" }]);

    const after = await listClaudeActivity({ date: "2026-11-02" }, ctx());
    expect(after.blocks).toHaveLength(0);
    await expect(
      logTime(
        { startAt: block.startAt, endAt: block.endAt, claudeSegmentIds: block.segmentIds },
        ctx(),
      ),
    ).rejects.toThrow(/déjà/);

    const next = await listClaudeActivity({ date: "2026-11-03" }, ctx());
    expect(next.blocks.map((b) => b.minutes)).toEqual([20]);
  });
});
