import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { projectRepos } from "@/db/schema/project-repos";
import { projects } from "@/db/schema/projects";
import { repoRoadmaps, taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { tasks } from "@/db/schema/tasks";
import { decideRoadmapLink, linkTaskToRoadmapItem } from "@/lib/actions/roadmap";
import { syncRepoRoadmap } from "@/lib/roadmap/sync";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * La feuille de route du dépôt pilote le statut des tâches liées. GitHub
 * est simulé par un `fetch` qui sert le `roadmap.json` courant ; le LLM
 * par un rapprochement sur les titres. On vérifie : l'instantané, les
 * suggestions, la confirmation qui aligne la tâche, la propagation quand
 * le fichier change, et que le rapprochement ne retourne pas au modèle
 * tant que rien n'a bougé.
 */

vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "GITHUB_TOKEN" },
  getSetting: async (key: string) => (key === "GITHUB_TOKEN" ? "token-test" : null),
}));

const matchMock = vi.fn(
  async (candidates: { id: string; title: string }[], items: { id: string; title: string }[]) => {
    const out: { taskId: string; itemId: string; confidence: number; reason: string }[] = [];
    for (const t of candidates) {
      const item = items.find((i) => t.title.toLowerCase().includes(i.title.toLowerCase()));
      if (item) out.push({ taskId: t.id, itemId: item.id, confidence: 0.9, reason: "même titre" });
    }
    return out;
  },
);
vi.mock("@/lib/roadmap/match", () => ({
  suggestRoadmapLinks: (...args: unknown[]) => matchMock(...(args as Parameters<typeof matchMock>)),
}));

let roadmap = {
  updated: "2026-10-28",
  statuses: { done: { label: "Livré" }, test: { label: "En test" }, todo: { label: "À faire" } },
  epics: [
    {
      id: "E1",
      name: "Channel Health",
      items: [
        { id: "1.1", status: "done", title: "Alertes email" },
        { id: "1.4", status: "test", title: "Alerte flux" },
        { id: "1.6", status: "todo", title: "Nettoyage des canaux" },
      ],
    },
  ],
};
let sha = "sha-1";

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (!url.includes("/contents/")) return new Response("{}", { status: 404 });
  return new Response(
    JSON.stringify({
      type: "file",
      sha,
      encoding: "base64",
      content: Buffer.from(JSON.stringify(roadmap)).toString("base64"),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let projectId: string;
const repo = {
  remote: "github.com/o/r",
  roadmapPath: "apps/web/src/data/roadmap.json",
  projectId: "",
};

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
    roadmapPath: repo.roadmapPath,
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

async function taskStatus(id: string) {
  const [row] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id));
  return row?.status;
}

describe("feuille de route du dépôt", () => {
  let alertes: string;
  let nettoyage: string;
  let facture: string;

  it("lit le fichier, stocke l'instantané et propose des rapprochements", async () => {
    alertes = await createTask("Finaliser les alertes email de suspension");
    nettoyage = await createTask("Nettoyage des canaux Bricomarché");
    facture = await createTask("Envoyer la facture mensuelle");

    const result = await syncRepoRoadmap(db, repo);
    expect(result.status).toBe("ok");
    expect(result.items).toBe(3);
    expect(result.suggested).toBe(2);
    expect(result.changedTasks).toBe(0);

    const [snap] = await db.select().from(repoRoadmaps).where(eq(repoRoadmaps.remote, repo.remote));
    expect(snap?.sha).toBe("sha-1");
    expect(snap?.matchedSha).toBe("sha-1");

    const links = await db.select().from(taskRoadmapLinks);
    expect(links.map((l) => [l.taskId, l.itemId, l.status]).sort()).toEqual(
      [
        [alertes, "1.1", "suggested"],
        [nettoyage, "1.6", "suggested"],
      ].sort(),
    );
    expect(await taskStatus(facture)).toBe("todo");
  });

  it("confirmer aligne la tâche sur l'item ; refuser ne repropose plus", async () => {
    const links = await db.select().from(taskRoadmapLinks);
    const alertesLink = links.find((l) => l.taskId === alertes);
    const nettoyageLink = links.find((l) => l.taskId === nettoyage);
    if (!alertesLink || !nettoyageLink) throw new Error("suggestions attendues");

    const confirmed = await decideRoadmapLink({ id: alertesLink.id, decision: "confirm" });
    expect(confirmed.ok && confirmed.data.statusChanged).toBe(true);
    expect(await taskStatus(alertes)).toBe("done");

    await decideRoadmapLink({ id: nettoyageLink.id, decision: "reject" });
    matchMock.mockClear();
    sha = "sha-2";
    roadmap = { ...roadmap, updated: "2026-10-29" };
    const again = await syncRepoRoadmap(db, repo);
    expect(matchMock).toHaveBeenCalledTimes(1);
    expect(again.suggested).toBe(0);
    expect(await taskStatus(nettoyage)).toBe("todo");
  });

  it("un lien manuel suit le fichier : en test puis livré", async () => {
    const flux = await createTask("Alerte flux d'offres");
    const linked = await linkTaskToRoadmapItem({
      taskId: flux,
      remote: repo.remote,
      itemId: "1.4",
    });
    expect(linked.ok).toBe(true);
    expect(await taskStatus(flux)).toBe("awaiting_client");

    sha = "sha-3";
    roadmap = {
      ...roadmap,
      epics: roadmap.epics.map((e) => ({
        ...e,
        items: e.items.map((i) => (i.id === "1.4" ? { ...i, status: "done" } : i)),
      })),
    };
    const result = await syncRepoRoadmap(db, repo);
    expect(result.changedTasks).toBe(1);
    expect(await taskStatus(flux)).toBe("done");
  });

  it("sans changement du fichier ni nouvelle tâche, le modèle n'est pas rappelé", async () => {
    matchMock.mockClear();
    const result = await syncRepoRoadmap(db, repo);
    expect(result.status).toBe("ok");
    expect(matchMock).not.toHaveBeenCalled();
  });
});
