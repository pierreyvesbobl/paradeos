import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { extractEmail } from "@/lib/gmail/extract";
import { extractAndSaveEmailProposals } from "@/lib/gmail/extract-and-save";
import type { ResolvedTaskCompletion } from "@/lib/meetings/completed-tasks";
import { extractMeeting } from "@/lib/meetings/extract";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Clôture de tâches d'après un transcript ou un mail. Le LLM est simulé :
 * on lui fait dire qu'une tâche connue est faite, et on vérifie ce que le
 * pipeline en fait — proposition, filtres, idempotence, acceptation,
 * annulation, mode automatique. Base, dédup et actions sont réels.
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
  completedTasks: [] as ResolvedTaskCompletion[],
};

const emptyEmailExtraction = {
  summary: "Le client confirme la réception.",
  intent: "info" as const,
  pipelineStage: "project" as const,
  proposedProjectName: null,
  proposedTasks: [],
  proposedEntities: [],
  proposedContacts: [],
  proposedProjects: [],
  needsReply: false,
  replyDraft: null,
  sensitiveDetected: false,
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
    .values({ name: "Site Bobl", kind: "client", status: "active" })
    .returning({ id: projects.id });
  if (!p) throw new Error("insert project");
  projectId = p.id;
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

async function createTask(title: string, status: "todo" | "in_progress" | "done" = "todo") {
  const [row] = await db
    .insert(tasks)
    .values({
      title,
      status,
      projectId,
      completedAt: status === "done" ? new Date("2026-10-01T10:00:00Z") : null,
      createdBy: actor.id,
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error("insert task");
  return row.id;
}

async function createMeeting(title = "Point hebdo") {
  const [row] = await db
    .insert(meetings)
    .values({
      title,
      transcript: "PY : j'ai envoyé le devis hier.",
      projectId,
      createdBy: actor.id,
    })
    .returning({ id: meetings.id });
  if (!row) throw new Error("insert meeting");
  return row.id;
}

async function createEmail() {
  const [thread] = await db
    .insert(gmailThreads)
    .values({ userId: actor.id, gmailThreadId: `gt-${crypto.randomUUID()}`, subject: "Devis" })
    .returning({ id: gmailThreads.id });
  if (!thread) throw new Error("insert thread");
  const [msg] = await db
    .insert(gmailMessages)
    .values({
      threadId: thread.id,
      userId: actor.id,
      gmailMessageId: `gm-${crypto.randomUUID()}`,
      fromEmail: "client@example.com",
      subject: "Devis",
      bodyText: "Bonjour, ci-joint le devis signé.",
      internalDate: new Date(),
      extractionStatus: "pending",
    })
    .returning({ id: gmailMessages.id });
  if (!msg) throw new Error("insert message");
  return { threadId: thread.id, messageId: msg.id };
}

function completion(
  taskId: string,
  title: string,
  confidence: "certain" | "probable" = "certain",
): ResolvedTaskCompletion {
  return {
    taskId,
    taskTitle: title,
    projectId,
    projectName: "Site Bobl",
    evidence: "j'ai envoyé le devis hier",
    confidence,
  };
}

async function meetingCompletions(meetingId: string) {
  return db
    .select()
    .from(meetingProposals)
    .where(
      and(eq(meetingProposals.meetingId, meetingId), eq(meetingProposals.kind, "task_completion")),
    );
}

async function taskRow(id: string) {
  const [row] = await db
    .select({ status: tasks.status, completedAt: tasks.completedAt })
    .from(tasks)
    .where(eq(tasks.id, id));
  if (!row) throw new Error("task introuvable");
  return row;
}

describe("extraction réunion : tâches données pour faites", () => {
  it("propose la clôture d'une tâche ouverte, ciblée par matchedId", async () => {
    const taskId = await createTask("Envoyer le devis");
    const meetingId = await createMeeting();
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      completedTasks: [completion(taskId, "Envoyer le devis")],
    });

    const res = await extractAndSaveProposals(meetingId);
    expect(res.count).toBe(1);

    const rows = await meetingCompletions(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.matchedId).toBe(taskId);
    expect(rows[0]?.matchConfidence).toBe("1.000");
    expect(rows[0]?.payload).toMatchObject({
      taskId,
      taskTitle: "Envoyer le devis",
      evidence: "j'ai envoyé le devis hier",
      confidence: "certain",
      auto: false,
    });
    expect(mockedExtractMeeting).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ priorityProjectId: projectId }),
    );
    // La tâche n'a pas bougé : sans décision, rien n'est écrit dessus.
    expect((await taskRow(taskId)).status).toBe("todo");
  });

  it("ne propose rien pour une tâche déjà terminée", async () => {
    const taskId = await createTask("Déjà faite", "done");
    const meetingId = await createMeeting();
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      completedTasks: [completion(taskId, "Déjà faite")],
    });
    await extractAndSaveProposals(meetingId);
    expect(await meetingCompletions(meetingId)).toHaveLength(0);
  });

  it("une ré-extraction conserve une clôture décidée et ne la repropose pas", async () => {
    const taskId = await createTask("Relancer Marc");
    const meetingId = await createMeeting();
    const said = {
      ...emptyMeetingExtraction,
      completedTasks: [completion(taskId, "Relancer Marc")],
    };
    mockedExtractMeeting.mockResolvedValueOnce(said);
    await extractAndSaveProposals(meetingId);
    const [first] = await meetingCompletions(meetingId);
    if (!first) throw new Error("proposition attendue");

    await db
      .update(meetingProposals)
      .set({ status: "rejected", decidedBy: actor.id, decidedAt: new Date() })
      .where(eq(meetingProposals.id, first.id));

    mockedExtractMeeting.mockResolvedValueOnce(said);
    await extractAndSaveProposals(meetingId);

    const after = await meetingCompletions(meetingId);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(first.id);
    expect(after[0]?.status).toBe("rejected");
  });

  it("une ré-extraction remplace une clôture restée en attente", async () => {
    const taskId = await createTask("Préparer la démo");
    const meetingId = await createMeeting();
    const said = {
      ...emptyMeetingExtraction,
      completedTasks: [completion(taskId, "Préparer la démo")],
    };
    mockedExtractMeeting.mockResolvedValueOnce(said);
    await extractAndSaveProposals(meetingId);
    mockedExtractMeeting.mockResolvedValueOnce(said);
    await extractAndSaveProposals(meetingId);
    const rows = await meetingCompletions(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
  });
});

describe("extraction mail : tâches données pour faites", () => {
  it("propose la clôture depuis un mail", async () => {
    const taskId = await createTask("Faire signer le devis");
    const { messageId } = await createEmail();
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      completedTasks: [completion(taskId, "Faire signer le devis")],
    });

    const res = await extractAndSaveEmailProposals(messageId);
    expect(res.skipped).toBe(false);

    const rows = await db
      .select()
      .from(emailProposals)
      .where(
        and(eq(emailProposals.messageId, messageId), eq(emailProposals.kind, "task_completion")),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.matchedId).toBe(taskId);
    expect(rows[0]?.status).toBe("pending");
  });

  it("n'ajoute pas une clôture déjà en attente sur une réunion", async () => {
    const taskId = await createTask("Envoyer les accès");
    const meetingId = await createMeeting();
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      completedTasks: [completion(taskId, "Envoyer les accès")],
    });
    await extractAndSaveProposals(meetingId);

    const { messageId } = await createEmail();
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      completedTasks: [completion(taskId, "Envoyer les accès")],
    });
    await extractAndSaveEmailProposals(messageId);

    const rows = await db
      .select()
      .from(emailProposals)
      .where(
        and(eq(emailProposals.messageId, messageId), eq(emailProposals.kind, "task_completion")),
      );
    expect(rows).toHaveLength(0);
  });
});
