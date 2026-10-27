import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import { acceptEmailProposal } from "@/lib/actions/email-proposals";
import { decideProposal } from "@/lib/actions/meetings";
import { getTaskSources } from "@/lib/db/queries/task-sources";
import { extractEmail } from "@/lib/gmail/extract";
import { extractAndSaveEmailProposals } from "@/lib/gmail/extract-and-save";
import type { ResolvedTaskCompletion } from "@/lib/meetings/completed-tasks";
import { extractMeeting } from "@/lib/meetings/extract";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import type { ResolvedTaskMention } from "@/lib/tasks/task-sources";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Ce qui a été dit d'une tâche. Le LLM est simulé : on lui fait renvoyer
 * des passages verbatim pour des tâches nouvelles ou connues, et on
 * vérifie où ils atterrissent — à l'acceptation pour une tâche créée, tout
 * de suite pour une tâche connue, sur la tâche existante quand la
 * proposition est écartée comme doublon — et que la ré-extraction ne
 * duplique rien.
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

async function createTask(title: string) {
  const [row] = await db
    .insert(tasks)
    .values({ title, status: "todo", projectId, createdBy: actor.id })
    .returning({ id: tasks.id });
  if (!row) throw new Error("insert task");
  return row.id;
}

async function createMeeting(title: string, occurredAt: Date) {
  const [row] = await db
    .insert(meetings)
    .values({
      title,
      transcript: "Vittorio : il faudrait une alerte quand le flux tombe.",
      occurredAt,
      projectId,
      createdBy: actor.id,
    })
    .returning({ id: meetings.id });
  if (!row) throw new Error("insert meeting");
  return row.id;
}

async function createEmail(subject: string) {
  const [thread] = await db
    .insert(gmailThreads)
    .values({ userId: actor.id, gmailThreadId: `gt-${crypto.randomUUID()}`, subject })
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
      subject,
      bodyText: "Pour l'alerte flux, il faut aussi couvrir Lengow.",
      internalDate: new Date("2026-10-02T09:00:00Z"),
      extractionStatus: "pending",
    })
    .returning({ id: gmailMessages.id });
  if (!msg) throw new Error("insert message");
  return msg.id;
}

async function sourcesOf(taskId: string) {
  return db
    .select({
      relation: taskSources.relation,
      excerpt: taskSources.excerpt,
      speaker: taskSources.speaker,
      meetingId: taskSources.meetingId,
      messageId: taskSources.messageId,
    })
    .from(taskSources)
    .where(eq(taskSources.taskId, taskId))
    .orderBy(asc(taskSources.createdAt));
}

describe("réunion : passages verbatim", () => {
  it("une tâche connue réévoquée reçoit ses passages dès l'extraction, sans doublon à la ré-extraction", async () => {
    const taskId = await createTask("Alerte flux d'offres");
    const meetingId = await createMeeting("Point du 22/09", new Date("2026-09-22T10:00:00Z"));
    const extraction = {
      ...emptyMeetingExtraction,
      mentionedTasks: [
        {
          taskId,
          taskTitle: "Alerte flux d'offres",
          excerpts: [
            { quote: "Il faudrait une alerte quand le flux tombe.", speaker: "Vittorio" },
            { quote: "Et Lengow aussi, pas que Miracle.", speaker: "Bénédicte" },
          ],
        },
      ],
    };
    mockedExtractMeeting.mockResolvedValueOnce(extraction);
    await extractAndSaveProposals(meetingId);

    let rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.relation)).toEqual(["mention", "mention"]);
    expect(rows[0]).toMatchObject({
      excerpt: "Il faudrait une alerte quand le flux tombe.",
      speaker: "Vittorio",
      meetingId,
      messageId: null,
    });

    // Ré-extraction : le modèle reformule la ponctuation, rien ne double.
    mockedExtractMeeting.mockResolvedValueOnce({
      ...extraction,
      mentionedTasks: [
        {
          taskId,
          taskTitle: "Alerte flux d'offres",
          excerpts: [
            { quote: "Il faudrait une alerte, quand le flux tombe", speaker: "Vittorio" },
            { quote: "Et Lengow aussi, pas que Miracle.", speaker: "Bénédicte" },
          ],
        },
      ],
    });
    await extractAndSaveProposals(meetingId);
    rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(2);
  });

  it("une tâche donnée pour faite garde la citation qui le prouve", async () => {
    const taskId = await createTask("Tester l'API Miracle");
    const meetingId = await createMeeting("Point du 29/09", new Date("2026-09-29T10:00:00Z"));
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      completedTasks: [
        {
          taskId,
          taskTitle: "Tester l'API Miracle",
          projectId,
          projectName: "GpasPlus",
          evidence: "l'API Miracle répond, j'ai les offres",
          confidence: "certain",
        },
      ],
    });
    await extractAndSaveProposals(meetingId);
    const rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      relation: "completion",
      excerpt: "l'API Miracle répond, j'ai les offres",
    });
  });

  it("une tâche nouvelle emporte ses passages dans la proposition, puis sur la tâche à l'acceptation", async () => {
    const meetingId = await createMeeting("Point du 09/10", new Date("2026-10-09T10:00:00Z"));
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      proposedTasks: [
        {
          title: "Contrôle de matching EAN",
          assigneeName: null,
          assigneeKind: null,
          dueDate: null,
          projectName: null,
          priority: null,
          excerpts: [
            {
              quote: "On a des EAN qui matchent sur le mauvais produit chez Boulanger.",
              speaker: "Vittorio",
            },
          ],
        },
      ],
    });
    await extractAndSaveProposals(meetingId);

    const [proposal] = await db
      .select()
      .from(meetingProposals)
      .where(eq(meetingProposals.meetingId, meetingId));
    expect(proposal?.kind).toBe("task");
    expect((proposal?.payload as Record<string, unknown> | undefined)?.excerpts).toEqual([
      {
        quote: "On a des EAN qui matchent sur le mauvais produit chez Boulanger.",
        speaker: "Vittorio",
      },
    ]);

    const res = await decideProposal({ proposalId: proposal?.id ?? "", action: "accept" });
    expect(res.ok).toBe(true);
    const taskId = res.ok ? (res.data.createdEntityId as string) : "";
    const rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relation: "origin", meetingId, speaker: "Vittorio" });
  });

  it("une proposition écartée comme doublon verse ses passages sur la tâche déjà ouverte", async () => {
    const taskId = await createTask("Renvoyer les invitations Vente Unique");
    const meetingId = await createMeeting("Point du 20/10", new Date("2026-10-20T10:00:00Z"));
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      proposedTasks: [
        {
          title: "Renvoyer les invitations Vente Unique",
          assigneeName: null,
          assigneeKind: null,
          dueDate: null,
          projectName: null,
          priority: null,
          excerpts: [
            { quote: "Les invitations Vente Unique sont toujours en attente.", speaker: "Éric" },
          ],
        },
      ],
    });
    const res = await extractAndSaveProposals(meetingId);
    expect(res.count).toBe(0);
    const rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relation: "mention", meetingId });
  });
});

describe("mail : passages verbatim", () => {
  it("une tâche connue réévoquée dans un mail reçoit ses passages", async () => {
    const taskId = await createTask("Alerte flux Lengow");
    const messageId = await createEmail("Re: alerte flux");
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      mentionedTasks: [
        {
          taskId,
          taskTitle: "Alerte flux Lengow",
          excerpts: [{ quote: "il faut aussi couvrir Lengow", speaker: "Vittorio Morino" }],
        },
      ],
    });
    await extractAndSaveEmailProposals(messageId);
    const rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relation: "mention", messageId, meetingId: null });
  });

  it("une tâche créée depuis un mail garde son passage d'origine", async () => {
    const messageId = await createEmail("Besoin : export des prix");
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      proposedTasks: [
        {
          title: "Export quotidien des prix",
          dueDate: null,
          projectName: null,
          assigneeName: null,
          priority: null,
          excerpts: [
            { quote: "un export quotidien des prix par canal", speaker: "Vittorio Morino" },
          ],
        },
      ],
    });
    await extractAndSaveEmailProposals(messageId);
    const [proposal] = await db
      .select()
      .from(emailProposals)
      .where(eq(emailProposals.messageId, messageId));
    expect(proposal?.kind).toBe("task");
    const res = await acceptEmailProposal({ proposalId: proposal?.id ?? "" });
    expect(res.ok).toBe(true);
    const taskId = res.ok ? (res.data.createdEntityId as string) : "";
    const rows = await sourcesOf(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relation: "origin", messageId });
  });
});

describe("lecture pour la fiche tâche", () => {
  it("groupe par source dans l'ordre chronologique, mail et réunion confondus", async () => {
    const taskId = await createTask("Dashboard offres actives");
    const laterMeeting = await createMeeting("Point du 26/10", new Date("2026-10-26T10:00:00Z"));
    const messageId = await createEmail("Dashboard"); // 02/10
    mockedExtractMeeting.mockResolvedValueOnce({
      ...emptyMeetingExtraction,
      mentionedTasks: [
        {
          taskId,
          taskTitle: "Dashboard offres actives",
          excerpts: [{ quote: "par pays", speaker: null }],
        },
      ],
    });
    await extractAndSaveProposals(laterMeeting);
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      mentionedTasks: [
        {
          taskId,
          taskTitle: "Dashboard offres actives",
          excerpts: [{ quote: "comme Seller Central", speaker: null }],
        },
      ],
    });
    await extractAndSaveEmailProposals(messageId);

    const groups = await getTaskSources(taskId);
    expect(groups.map((g) => g.source)).toEqual(["email", "meeting"]);
    expect(groups[0]).toMatchObject({ label: "Dashboard", fromName: "Vittorio Morino" });
    expect(groups[1]?.excerpts[0]).toMatchObject({ quote: "par pays", relation: "mention" });
  });
});
