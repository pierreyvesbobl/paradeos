import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { taskGithubIssues } from "@/db/schema/task-github-issues";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import { decideProposal } from "@/lib/actions/meetings";
import { patchTask } from "@/lib/actions/tasks";
import { projectTaskToIssue } from "@/lib/github/project-issue";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Projection d'une tâche en issue GitHub, à sens unique. GitHub est
 * simulé par un `fetch` qui enregistre ce qu'on lui envoie : on vérifie le
 * dépôt visé, le brief (citations attribuées, lien retour, marqueur), que
 * rien ne repart si le brief n'a pas changé, et que l'acceptation d'une
 * proposition « Fonctionnalité » crée l'issue sans que l'humain y pense.
 */

vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "GITHUB_TOKEN", TASK_AUTOCOMPLETE_ENABLED: "X" },
  getSetting: async (key: string) => (key === "GITHUB_TOKEN" ? "token-test" : null),
}));
vi.mock("@/lib/app-url", () => ({
  getAppUrl: async () => "https://paradeos.test",
  getAppUrlFromEnv: () => "https://paradeos.test",
}));

type Call = { url: string; method: string; body: Record<string, unknown> };
const calls: Call[] = [];
let nextNumber = 40;

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  calls.push({ url, method, body });
  if (method === "POST") {
    nextNumber += 1;
    return new Response(
      JSON.stringify({
        number: nextNumber,
        html_url: `https://github.com/o/r/issues/${nextNumber}`,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({}), { status: 200 });
});

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  actAs(actor);
  vi.stubGlobal("fetch", fetchMock);
  const [p] = await db
    .insert(projects)
    .values({ name: "GpasPlus", kind: "client", status: "active" })
    .returning({ id: projects.id });
  if (!p) throw new Error("insert project");
  projectId = p.id;
  await db.insert(projectRepos).values({
    projectId,
    remote: "github.com/o/r",
    syncIssues: true,
    createdBy: actor.id,
  });
});

afterEach(() => {
  calls.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  useTestDb(null);
  await close();
});

async function createTask(title: string, kind: "feature" | "investigation" | "action" | null) {
  const [row] = await db
    .insert(tasks)
    .values({ title, status: "todo", projectId, kind, createdBy: actor.id })
    .returning({ id: tasks.id });
  if (!row) throw new Error("insert task");
  return row.id;
}

describe("projection d'une tâche en issue", () => {
  it("crée l'issue avec le brief, puis ne repousse que si le brief change", async () => {
    const [m] = await db
      .insert(meetings)
      .values({
        title: "Point Tech",
        transcript: "x",
        occurredAt: new Date("2026-10-20T12:00:00Z"),
        projectId,
        createdBy: actor.id,
      })
      .returning({ id: meetings.id });
    if (!m) throw new Error("insert meeting");
    const taskId = await createTask("Alerte email suspension", "feature");
    await db.insert(taskSources).values({
      taskId,
      sourceKind: "meeting",
      meetingId: m.id,
      relation: "origin",
      excerpt: "il restera les alertes email pour les suspensions",
      speaker: "Eric Alessandri",
      excerptFingerprint: "fp1",
    });

    const first = await projectTaskToIssue(taskId);
    expect(first.status).toBe("created");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/o/r/issues",
    });
    const body = calls[0]?.body as { title: string; body: string; labels: string[] };
    expect(body.title).toBe("Alerte email suspension");
    expect(body.labels).toEqual(["paradeos"]);
    expect(body.body).toContain("> il restera les alertes email pour les suspensions");
    expect(body.body).toContain("> — Eric Alessandri _(à l'origine)_");
    expect(body.body).toContain(`https://paradeos.test/taches/${taskId}`);
    expect(body.body).toContain(`<!-- paradeos:task:${taskId} -->`);

    const [row] = await db
      .select()
      .from(taskGithubIssues)
      .where(eq(taskGithubIssues.taskId, taskId));
    expect(row).toMatchObject({ remote: "github.com/o/r", number: 41 });

    // Même brief : rien ne part.
    const second = await projectTaskToIssue(taskId);
    expect(second.status).toBe("unchanged");
    expect(calls).toHaveLength(1);

    // Renommée depuis la fiche : l'issue est mise à jour, pas recréée.
    const res = await patchTask({ id: taskId, title: "Alerte email suspension marketplace" });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      url: "https://api.github.com/repos/o/r/issues/41",
    });
    expect((calls[1]?.body as { title?: string } | undefined)?.title).toBe(
      "Alerte email suspension marketplace",
    );
  });

  it("ne projette ni une action humaine ni une tâche d'un projet sans dépôt qui projette", async () => {
    const actionId = await createTask("Relancer Bagheera", "action");
    expect(await projectTaskToIssue(actionId)).toEqual({
      status: "skipped",
      reason: "not_feature",
    });

    const [other] = await db
      .insert(projects)
      .values({ name: "Autre", kind: "client", status: "active" })
      .returning({ id: projects.id });
    const [t] = await db
      .insert(tasks)
      .values({
        title: "Export",
        status: "todo",
        kind: "feature",
        projectId: other?.id,
        createdBy: actor.id,
      })
      .returning({ id: tasks.id });
    expect(await projectTaskToIssue(t?.id ?? "")).toEqual({ status: "skipped", reason: "no_repo" });
    expect(calls).toHaveLength(0);
  });

  it("passer une tâche en Fonctionnalité depuis la fiche crée l'issue", async () => {
    const taskId = await createTask("Corriger le calcul des commissions", null);
    const res = await patchTask({ id: taskId, kind: "feature" });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    const [row] = await db
      .select()
      .from(taskGithubIssues)
      .where(eq(taskGithubIssues.taskId, taskId));
    expect(row?.url).toMatch(/^https:\/\/github\.com\/o\/r\/issues\/\d+$/);
  });

  it("accepter une proposition typée Fonctionnalité crée la tâche typée et son issue", async () => {
    const [m] = await db
      .insert(meetings)
      .values({ title: "Point", transcript: "x", projectId, createdBy: actor.id })
      .returning({ id: meetings.id });
    const [proposal] = await db
      .insert(meetingProposals)
      .values({
        meetingId: m?.id ?? "",
        kind: "task",
        payload: {
          title: "Remonter le stock Spacefill par canal",
          projectId,
          kind: "feature",
          excerpts: [{ quote: "il faut voir le stock par canal", speaker: "Eric" }],
        },
      })
      .returning({ id: meetingProposals.id });
    const res = await decideProposal({ proposalId: proposal?.id ?? "", action: "accept" });
    expect(res.ok).toBe(true);
    const taskId = res.ok ? (res.data.createdEntityId as string) : "";
    const [task] = await db.select({ kind: tasks.kind }).from(tasks).where(eq(tasks.id, taskId));
    expect(task?.kind).toBe("feature");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect((calls[0]?.body as { body?: string } | undefined)?.body).toContain(
      "> il faut voir le stock par canal",
    );
    const [row] = await db
      .select()
      .from(taskGithubIssues)
      .where(eq(taskGithubIssues.taskId, taskId));
    expect(row).toBeTruthy();
  });
});
