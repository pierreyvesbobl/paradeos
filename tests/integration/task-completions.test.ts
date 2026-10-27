import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { appSettings } from "@/db/schema/app-settings";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import {
  acceptEmailProposal,
  rejectEmailProposal,
  revertEmailProposal,
} from "@/lib/actions/email-proposals";
import { decideProposal, revertProposal, updateAcceptedProposal } from "@/lib/actions/meetings";
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
  mentionedTasks: [],
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
  mentionedTasks: [],
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

describe("décider une clôture proposée par une réunion", () => {
  async function propose(title: string, status: "todo" | "in_progress" = "todo") {
    const taskId = await createTask(title, status);
    const meetingId = await createMeeting();
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      completedTasks: [completion(taskId, title)],
    });
    await extractAndSaveProposals(meetingId);
    const [proposal] = await meetingCompletions(meetingId);
    if (!proposal) throw new Error("proposition attendue");
    return { taskId, meetingId, proposalId: proposal.id };
  }

  it("accepter passe la tâche en done et mémorise l'état d'avant", async () => {
    const { taskId, proposalId } = await propose("Envoyer la facture", "in_progress");
    const res = await decideProposal({ proposalId, action: "accept" });
    expect(res.ok).toBe(true);

    const task = await taskRow(taskId);
    expect(task.status).toBe("done");
    expect(task.completedAt).not.toBeNull();

    const [row] = await db
      .select()
      .from(meetingProposals)
      .where(eq(meetingProposals.id, proposalId));
    expect(row?.status).toBe("accepted");
    expect(row?.createdEntityId).toBe(taskId);
    expect(row?.decidedBy).toBe(actor.id);
    expect(row?.payload).toMatchObject({
      previousStatus: "in_progress",
      previousCompletedAt: null,
    });
  });

  it("rejeter ne touche pas à la tâche", async () => {
    const { taskId, proposalId } = await propose("Appeler le client");
    await decideProposal({ proposalId, action: "reject" });
    expect((await taskRow(taskId)).status).toBe("todo");
  });

  it("annuler rouvre la tâche dans son statut d'avant", async () => {
    const { taskId, proposalId } = await propose("Livrer la maquette", "in_progress");
    await decideProposal({ proposalId, action: "accept" });
    const res = await revertProposal({ proposalId });
    expect(res.ok).toBe(true);

    const task = await taskRow(taskId);
    expect(task.status).toBe("in_progress");
    expect(task.completedAt).toBeNull();
    const [row] = await db
      .select({ status: meetingProposals.status })
      .from(meetingProposals)
      .where(eq(meetingProposals.id, proposalId));
    expect(row?.status).toBe("pending");
  });

  it("annuler ne touche pas une tâche rouverte à la main entre-temps", async () => {
    const { taskId, proposalId } = await propose("Préparer le contrat");
    await decideProposal({ proposalId, action: "accept" });
    await db
      .update(tasks)
      .set({ status: "blocked", completedAt: null })
      .where(eq(tasks.id, taskId));
    await revertProposal({ proposalId });
    expect((await taskRow(taskId)).status).toBe("blocked");
  });

  it("une clôture acceptée ne s'édite pas", async () => {
    const { proposalId } = await propose("Envoyer le planning");
    await decideProposal({ proposalId, action: "accept" });
    const res = await updateAcceptedProposal({ proposalId, payload: { taskTitle: "Autre" } });
    expect(res.ok).toBe(false);
  });
});

describe("décider une clôture proposée par un mail", () => {
  async function propose(title: string) {
    const taskId = await createTask(title);
    const { messageId } = await createEmail();
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      completedTasks: [completion(taskId, title)],
    });
    await extractAndSaveEmailProposals(messageId);
    const [proposal] = await db
      .select()
      .from(emailProposals)
      .where(
        and(eq(emailProposals.messageId, messageId), eq(emailProposals.kind, "task_completion")),
      );
    if (!proposal) throw new Error("proposition attendue");
    return { taskId, proposalId: proposal.id };
  }

  it("accepter, puis annuler, puis rejeter", async () => {
    const { taskId, proposalId } = await propose("Faire valider la charte");

    const accepted = await acceptEmailProposal({ proposalId, payloadOverride: null });
    expect(accepted.ok).toBe(true);
    expect((await taskRow(taskId)).status).toBe("done");
    const [afterAccept] = await db
      .select()
      .from(emailProposals)
      .where(eq(emailProposals.id, proposalId));
    expect(afterAccept?.createdEntityId).toBe(taskId);
    expect(afterAccept?.payload).toMatchObject({ previousStatus: "todo" });

    const reverted = await revertEmailProposal({ proposalId });
    expect(reverted.ok).toBe(true);
    expect((await taskRow(taskId)).status).toBe("todo");

    const rejected = await rejectEmailProposal({ proposalId });
    expect(rejected.ok).toBe(true);
    expect((await taskRow(taskId)).status).toBe("todo");
  });
});

describe("clôture automatique (TASK_AUTOCOMPLETE_ENABLED)", () => {
  async function setAuto(enabled: boolean) {
    const value = enabled ? "true" : "false";
    await db
      .insert(appSettings)
      .values({ key: "TASK_AUTOCOMPLETE_ENABLED", value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  it("une détection certaine clôture la tâche sans clic, trace annulable", async () => {
    await setAuto(true);
    try {
      const taskId = await createTask("Envoyer le compte-rendu", "in_progress");
      const meetingId = await createMeeting();
      mockedExtractMeeting.mockResolvedValueOnce({
        ...emptyMeetingExtraction,
        completedTasks: [completion(taskId, "Envoyer le compte-rendu", "certain")],
      });
      const res = await extractAndSaveProposals(meetingId);
      expect(res.autoCompletedTasks).toBe(1);

      expect((await taskRow(taskId)).status).toBe("done");
      const [row] = await meetingCompletions(meetingId);
      expect(row?.status).toBe("accepted");
      expect(row?.decidedBy).toBeNull();
      expect(row?.decidedAt).not.toBeNull();
      expect(row?.createdEntityId).toBe(taskId);
      expect(row?.payload).toMatchObject({ auto: true, previousStatus: "in_progress" });

      // Annulable comme une décision humaine : la tâche revient.
      if (!row) throw new Error("ligne attendue");
      await revertProposal({ proposalId: row.id });
      expect((await taskRow(taskId)).status).toBe("in_progress");

      // Après l'annulation, la ré-extraction repropose sans jamais
      // re-clôturer d'office : la question a déjà été posée.
      mockedExtractMeeting.mockResolvedValueOnce({
        ...emptyMeetingExtraction,
        completedTasks: [completion(taskId, "Envoyer le compte-rendu", "certain")],
      });
      const again = await extractAndSaveProposals(meetingId);
      expect(again.autoCompletedTasks).toBe(0);
      expect((await taskRow(taskId)).status).toBe("in_progress");
      const rows = await meetingCompletions(meetingId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("pending");
    } finally {
      await setAuto(false);
    }
  });

  it("une détection probable reste une proposition même en mode automatique", async () => {
    await setAuto(true);
    try {
      const taskId = await createTask("Relancer le fournisseur");
      const meetingId = await createMeeting();
      mockedExtractMeeting.mockResolvedValueOnce({
        ...emptyMeetingExtraction,
        completedTasks: [completion(taskId, "Relancer le fournisseur", "probable")],
      });
      await extractAndSaveProposals(meetingId);
      expect((await taskRow(taskId)).status).toBe("todo");
      const [row] = await meetingCompletions(meetingId);
      expect(row?.status).toBe("pending");
      expect(row?.matchConfidence).toBe("0.750");
    } finally {
      await setAuto(false);
    }
  });

  it("réglage éteint : une détection certaine reste une proposition", async () => {
    const taskId = await createTask("Publier l'article");
    const { messageId } = await createEmail();
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      completedTasks: [completion(taskId, "Publier l'article", "certain")],
    });
    const res = await extractAndSaveEmailProposals(messageId);
    expect(res.skipped).toBe(false);
    expect(res.autoCompletedTasks).toBe(0);
    expect((await taskRow(taskId)).status).toBe("todo");
  });

  it("mail en mode automatique : clôture directe", async () => {
    await setAuto(true);
    try {
      const taskId = await createTask("Transmettre les accès FTP");
      const { messageId } = await createEmail();
      mockedExtractEmail.mockResolvedValueOnce({
        ...emptyEmailExtraction,
        completedTasks: [completion(taskId, "Transmettre les accès FTP", "certain")],
      });
      const res = await extractAndSaveEmailProposals(messageId);
      expect(res.autoCompletedTasks).toBe(1);
      expect((await taskRow(taskId)).status).toBe("done");
      const [row] = await db
        .select()
        .from(emailProposals)
        .where(
          and(eq(emailProposals.messageId, messageId), eq(emailProposals.kind, "task_completion")),
        );
      expect(row?.status).toBe("accepted");
      expect(row?.decidedBy).toBeNull();
    } finally {
      await setAuto(false);
    }
  });
});
