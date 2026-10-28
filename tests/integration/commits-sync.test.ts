import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { repoCommits, taskCommitLinks } from "@/db/schema/repo-commits";
import { tasks } from "@/db/schema/tasks";
import { decideCommitLink } from "@/lib/actions/commits";
import { upsertCommits } from "@/lib/repos/commits";
import { syncRepoCommits } from "@/lib/repos/commits-sync";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Les commits d'un dépôt suivi arrivent par GitHub (simulé) ou par le mod
 * (`upsertCommits`, même table, idempotent par sha), sont rapprochés une
 * fois des tâches ouvertes (LLM simulé sur les titres), et confirmer une
 * suggestion termine la tâche.
 */

vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "GITHUB_TOKEN" },
  getSetting: async (key: string) => (key === "GITHUB_TOKEN" ? "token-test" : null),
}));

const matchMock = vi.fn(
  async (
    commits: { sha: string; subject: string }[],
    candidates: { id: string; title: string }[],
  ) => {
    const out: { taskId: string; sha: string; confidence: number; reason: string }[] = [];
    for (const c of commits) {
      const task = candidates.find((t) =>
        c.subject.toLowerCase().includes(t.title.split(" ")[0]?.toLowerCase() ?? "§"),
      );
      if (task) out.push({ taskId: task.id, sha: c.sha, confidence: 0.9, reason: "même sujet" });
    }
    return out;
  },
);
vi.mock("@/lib/repos/match-commits", () => ({
  suggestCommitLinks: (...args: unknown[]) => matchMock(...(args as Parameters<typeof matchMock>)),
}));

const githubCommits = [
  {
    sha: "a".repeat(40),
    html_url: "https://github.com/o/r/commit/a",
    commit: {
      message: "Alertes : vague multi-canaux en un seul email\n\nDétail du commit.",
      author: { name: "PY", date: "2026-10-26T10:00:00Z" },
    },
  },
  {
    sha: "b".repeat(40),
    html_url: "https://github.com/o/r/commit/b",
    commit: {
      message: "Feuille de route : statut En test",
      author: { name: "PY", date: "2026-10-25T10:00:00Z" },
    },
  },
];

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (!url.includes("/commits?")) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify(githubCommits), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let projectId: string;
const repo = { remote: "github.com/o/r", projectId: "" };

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
  repo.projectId = projectId;
  await db.insert(projectRepos).values({
    projectId,
    remote: repo.remote,
    syncIssues: true,
    createdBy: actor.id,
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  useTestDb(null);
  await close();
});

async function createTask(title: string) {
  const [row] = await db
    .insert(tasks)
    .values({ title, status: "todo", projectId, createdBy: actor.id })
    .returning({ id: tasks.id });
  if (!row) throw new Error("insert task");
  return row.id;
}

describe("commits des dépôts suivis", () => {
  let alertes: string;

  it("lit GitHub, stocke les commits et propose quelle tâche chacun livre", async () => {
    alertes = await createTask("Alertes email multi-canaux");
    await createTask("Facture mensuelle à envoyer");

    const result = await syncRepoCommits(db, repo);
    expect(result.status).toBe("ok");
    expect(result.added).toBe(2);
    expect(result.suggested).toBe(1);

    const stored = await db.select().from(repoCommits).where(eq(repoCommits.remote, repo.remote));
    expect(stored).toHaveLength(2);
    expect(stored.every((c) => c.matchedAt !== null)).toBe(true);
    const a = stored.find((c) => c.sha === "a".repeat(40));
    expect(a?.subject).toBe("Alertes : vague multi-canaux en un seul email");
    expect(a?.body).toBe("Détail du commit.");
    expect(a?.source).toBe("github");
  });

  it("une deuxième passe ne rappelle pas le modèle sur des commits déjà vus", async () => {
    matchMock.mockClear();
    const again = await syncRepoCommits(db, repo);
    expect(again.added).toBe(0);
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("le mod pousse un commit local : stocké une fois, source claude_code", async () => {
    const added = await upsertCommits(
      db,
      repo.remote,
      [
        {
          sha: "c".repeat(40),
          subject: "Alertes : destinataires",
          committedAt: "2026-10-27T09:00:00Z",
        },
        { sha: "a".repeat(40), subject: "déjà connu", committedAt: "2026-10-26T10:00:00Z" },
      ],
      "claude_code",
    );
    expect(added).toBe(1);
    const result = await syncRepoCommits(db, repo);
    expect(result.suggested).toBe(1);
  });

  it("confirmer une suggestion termine la tâche", async () => {
    const [link] = await db
      .select({ id: taskCommitLinks.id })
      .from(taskCommitLinks)
      .where(eq(taskCommitLinks.sha, "a".repeat(40)));
    if (!link) throw new Error("suggestion attendue");
    const res = await decideCommitLink({ id: link.id, decision: "confirm" });
    expect(res.ok && res.data.statusChanged).toBe(true);
    const [task] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, alertes));
    expect(task?.status).toBe("done");
  });
});
