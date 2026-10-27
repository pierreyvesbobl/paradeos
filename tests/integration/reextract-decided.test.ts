import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import { extractEmail } from "@/lib/gmail/extract";
import { extractAndSaveEmailProposals } from "@/lib/gmail/extract-and-save";
import type { ResolvedTaskCompletion } from "@/lib/meetings/completed-tasks";
import { extractMeeting } from "@/lib/meetings/extract";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import type { ResolvedTaskMention } from "@/lib/tasks/task-sources";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Ré-extraire une source déjà triée doit être sans risque : ce que
 * l'humain a accepté ou refusé reste, un refus ne revient pas dans l'inbox,
 * une acceptation n'est pas reposée, et la tâche née d'une acceptation
 * reçoit les passages de la nouvelle passe comme origine.
 */

const emptyMeetingExtraction = {
  summary: "Point projet.",
  occurredAt: null,
  attendees: [],
  decisions: [],
  proposedEntities: [],
  proposedContacts: [],
  proposedProjects: [],
  proposedTasks: [],
  mentionedTasks: [] as ResolvedTaskMention[],
  completedTasks: [] as ResolvedTaskCompletion[],
};

const emptyEmailExtraction = {
  summary: "Le client précise son besoin.",
  intent: "request" as const,
  pipelineStage: "project" as const,
  proposedProjectName: null,
  proposedTasks: [],
  proposedEntities: [],
  proposedContacts: [],
  proposedProjects: [],
  needsReply: false,
  replyDraft: null,
  sensitiveDetected: false,
  mentionedTasks: [] as ResolvedTaskMention[],
  completedTasks: [] as ResolvedTaskCompletion[],
};

vi.mock("@/lib/meetings/extract", () => ({
  extractMeeting: vi.fn(async () => emptyMeetingExtraction),
}));
vi.mock("@/lib/gmail/extract", () => ({
  extractEmail: vi.fn(async () => emptyEmailExtraction),
}));

const mockedExtractMeeting = vi.mocked(extractMeeting);
const mockedExtractEmail = vi.mocked(extractEmail);

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  actAs(actor);
  const [p] = await db
    .insert(projects)
    .values({ name: "GpasPlus", kind: "client", status: "active" })
    .returning({ id: projects.id });
  if (!p) throw new Error("insert project");
  projectId = p.id;
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

function proposedTask(title: string, quote: string) {
  return {
    title,
    assigneeName: null,
    assigneeKind: null,
    dueDate: null,
    projectName: null,
    priority: null,
    kind: null,
    excerpts: [{ quote, speaker: "Eric" }],
  };
}

describe("réunion déjà triée", () => {
  it("garde les décisions, ne repose ni refus ni acceptation, pose l'origine sur la tâche créée", async () => {
    const [m] = await db
      .insert(meetings)
      .values({
        title: "Point Tech",
        transcript: "Eric : on lance le contrôle EAN. Bénédicte : je réponds à Temu.",
        occurredAt: new Date("2026-10-20T14:00:00Z"),
        projectId,
        createdBy: actor.id,
      })
      .returning({ id: meetings.id });
    if (!m) throw new Error("insert meeting");
    const meetingId = m.id;

    // Première passe : deux propositions, l'humain en accepte une (tâche
    // créée) et refuse l'autre. On pose l'état final directement.
    const [created] = await db
      .insert(tasks)
      .values({ title: "Contrôle de matching EAN", status: "todo", projectId, createdBy: actor.id })
      .returning({ id: tasks.id });
    if (!created) throw new Error("insert task");
    await db.insert(meetingProposals).values([
      {
        meetingId,
        kind: "task",
        payload: { title: "Contrôle de matching EAN", projectId },
        status: "accepted",
        createdEntityId: created.id,
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
      {
        meetingId,
        kind: "task",
        payload: { title: "Répondre à Temu", projectId },
        status: "rejected",
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
      {
        meetingId,
        kind: "task",
        payload: {
          title: "Relancer une recatégorisation des produits vendus en matching EAN",
          projectId,
        },
        status: "rejected",
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
      {
        meetingId,
        kind: "task",
        payload: { title: "Vieille proposition en attente", projectId },
        status: "pending",
      },
    ]);

    // Deuxième passe : le modèle redit les deux, avec un titre un peu
    // différent pour la tâche acceptée, plus une inédite.
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      proposedTasks: [
        proposedTask("Contrôle de matching EAN", "tu peux prendre le dossier, c'est officiel"),
        proposedTask("Répondre à Temu", "il faut que je réponde à Temu"),
        // Refus reformulé par le modèle : même besoin, pas une nouveauté.
        proposedTask("Relancer une recatégorisation des produits en matching EAN", "je relance"),
        proposedTask("Monitorer les trackings PrestaShop", "monitorer les trackings"),
      ],
      // La tâche acceptée est aussi réévoquée comme tâche connue.
      mentionedTasks: [
        {
          taskId: created.id,
          taskTitle: "Contrôle de matching EAN",
          excerpts: [
            {
              quote: "en n'oubliant pas de finir celui qu'on est en train de faire",
              speaker: "Eric",
            },
          ],
        },
      ],
    });
    await extractAndSaveProposals(meetingId);

    const rows = await db
      .select({
        kind: meetingProposals.kind,
        status: meetingProposals.status,
        payload: meetingProposals.payload,
      })
      .from(meetingProposals)
      .where(eq(meetingProposals.meetingId, meetingId));
    const byTitle = new Map(
      rows.map((r) => [(r.payload as { title: string }).title, r.status] as const),
    );
    expect(byTitle.get("Contrôle de matching EAN")).toBe("accepted");
    expect(byTitle.get("Répondre à Temu")).toBe("rejected");
    expect(byTitle.get("Monitorer les trackings PrestaShop")).toBe("pending");
    expect(byTitle.has("Vieille proposition en attente")).toBe(false);
    expect(byTitle.has("Relancer une recatégorisation des produits en matching EAN")).toBe(false);
    expect(rows).toHaveLength(4);

    const sources = await db
      .select({ relation: taskSources.relation, excerpt: taskSources.excerpt })
      .from(taskSources)
      .where(eq(taskSources.taskId, created.id));
    expect(sources.map((s) => s.relation)).toEqual(["origin", "origin"]);
    expect(sources.map((s) => s.excerpt).sort()).toEqual([
      "en n'oubliant pas de finir celui qu'on est en train de faire",
      "tu peux prendre le dossier, c'est officiel",
    ]);
  });
});

describe("mail déjà trié", () => {
  it("un refus ne revient pas, la tâche acceptée reçoit l'origine", async () => {
    const [thread] = await db
      .insert(gmailThreads)
      .values({ userId: actor.id, gmailThreadId: `gt-${crypto.randomUUID()}`, subject: "Prix" })
      .returning({ id: gmailThreads.id });
    if (!thread) throw new Error("insert thread");
    const [msg] = await db
      .insert(gmailMessages)
      .values({
        threadId: thread.id,
        userId: actor.id,
        gmailMessageId: `gm-${crypto.randomUUID()}`,
        fromEmail: "vittorio@gpasplus.com",
        fromName: "Vittorio Morino",
        subject: "Prix",
        bodyText: "Un export quotidien des prix, et relancez Bagheera.",
        internalDate: new Date("2026-10-02T09:00:00Z"),
        extractionStatus: "pending",
      })
      .returning({ id: gmailMessages.id });
    if (!msg) throw new Error("insert message");
    const messageId = msg.id;

    const [created] = await db
      .insert(tasks)
      .values({ title: "Export quotidien des prix", status: "todo", createdBy: actor.id })
      .returning({ id: tasks.id });
    if (!created) throw new Error("insert task");
    await db.insert(emailProposals).values([
      {
        messageId,
        kind: "task",
        payload: { title: "Export quotidien des prix", projectId: null },
        status: "accepted",
        createdEntityId: created.id,
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
      {
        messageId,
        kind: "task",
        payload: { title: "Relancer Bagheera", projectId: null },
        status: "rejected",
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
    ]);

    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      proposedTasks: [
        {
          title: "Export quotidien des prix",
          dueDate: null,
          projectName: null,
          assigneeName: null,
          priority: null,
          kind: null,
          excerpts: [{ quote: "un export quotidien des prix", speaker: "Vittorio Morino" }],
        },
        {
          title: "Relancer Bagheera",
          dueDate: null,
          projectName: null,
          assigneeName: null,
          priority: null,
          kind: null,
          excerpts: [{ quote: "relancez Bagheera", speaker: "Vittorio Morino" }],
        },
      ],
    });
    await extractAndSaveEmailProposals(messageId);

    const rows = await db
      .select({ kind: emailProposals.kind, status: emailProposals.status })
      .from(emailProposals)
      .where(eq(emailProposals.messageId, messageId));
    expect(
      rows
        .filter((r) => r.kind === "task")
        .map((r) => r.status)
        .sort(),
    ).toEqual(["accepted", "rejected"]);

    const sources = await db
      .select({ relation: taskSources.relation, excerpt: taskSources.excerpt })
      .from(taskSources)
      .where(eq(taskSources.taskId, created.id));
    expect(sources).toEqual([{ relation: "origin", excerpt: "un export quotidien des prix" }]);
  });
});
