import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import {
  expireAnsweredProposals,
  expireAutomatedSenderProposals,
  expireStaleEmailProposals,
  expireStaleMeetingProposals,
  PROPOSAL_TTL_DAYS,
} from "@/lib/crm/expire-proposals";
import { extractEmail } from "@/lib/gmail/extract";
import { extractAndSaveEmailProposals } from "@/lib/gmail/extract-and-save";
import type { ResolvedTaskCompletion } from "@/lib/meetings/completed-tasks";
import type { ResolvedTaskMention } from "@/lib/tasks/task-sources";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * La file de propositions doit rester digeste : pas d'extraction sur un
 * expéditeur machine, péremption de ce que personne ne tranche, et une
 * proposition périmée n'est pas un refus (une ré-extraction la repose).
 */

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
  sensitiveDetected: false,
  mentionedTasks: [] as ResolvedTaskMention[],
  completedTasks: [] as ResolvedTaskCompletion[],
};

vi.mock("@/lib/gmail/extract", () => ({
  extractEmail: vi.fn(async () => emptyEmailExtraction),
}));
const mockedExtractEmail = vi.mocked(extractEmail);

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;
let other: TestUser;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  other = await seedUser(db, { role: "member" });
  actAs(actor);
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

async function insertMessage(opts: {
  userId: string;
  fromEmail: string;
  fromName?: string;
  subject?: string;
  extractionMeta?: Record<string, unknown>;
  /** Fil existant où ranger le message (sinon un fil neuf). */
  threadId?: string;
  internalDate?: Date;
  labels?: string[];
}) {
  const subject = opts.subject ?? "Sujet";
  let threadId = opts.threadId;
  if (!threadId) {
    const [thread] = await db
      .insert(gmailThreads)
      .values({ userId: opts.userId, gmailThreadId: `gt-${crypto.randomUUID()}`, subject })
      .returning({ id: gmailThreads.id });
    if (!thread) throw new Error("insert thread");
    threadId = thread.id;
  }
  const [msg] = await db
    .insert(gmailMessages)
    .values({
      threadId,
      userId: opts.userId,
      gmailMessageId: `gm-${crypto.randomUUID()}`,
      fromEmail: opts.fromEmail,
      fromName: opts.fromName ?? null,
      subject,
      bodyText: "Corps du message.",
      internalDate: opts.internalDate ?? new Date("2026-10-20T09:00:00Z"),
      labels: opts.labels ?? [],
      extractionStatus: "pending",
      extractionMeta: opts.extractionMeta ?? null,
    })
    .returning({ id: gmailMessages.id });
  if (!msg) throw new Error("insert message");
  return msg.id;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("expéditeur automatique", () => {
  it("ne passe pas par le LLM et marque le message comme sauté", async () => {
    const messageId = await insertMessage({
      userId: actor.id,
      fromEmail: "notifications@stripe.com",
      fromName: "Stripe",
      subject: "Votre reçu",
    });
    mockedExtractEmail.mockClear();

    const r = await extractAndSaveEmailProposals(messageId);

    expect(r).toMatchObject({ skipped: true, reason: "expéditeur automatique", count: 0 });
    expect(mockedExtractEmail).not.toHaveBeenCalled();
    const [msg] = await db
      .select({ status: gmailMessages.extractionStatus })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, messageId));
    expect(msg?.status).toBe("skipped");
  });
});

describe("fil rejoué pour ses tâches terminées", () => {
  it("garde les passages sur la tâche, sans reposer de proposition", async () => {
    const [done] = await db
      .insert(tasks)
      .values({
        title: "Export des prix",
        status: "done",
        completedAt: daysAgo(10),
        createdBy: actor.id,
      })
      .returning({ id: tasks.id });
    if (!done) throw new Error("insert task");
    const messageId = await insertMessage({
      userId: actor.id,
      fromEmail: "vittorio@gpasplus.com",
      subject: "Merci pour l'export",
      extractionMeta: { requeuedForDoneTasks: true },
    });
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      proposedTasks: [
        {
          title: "Ajouter la colonne stock",
          dueDate: null,
          projectName: null,
          assigneeName: null,
          priority: null,
          kind: null,
          excerpts: [{ quote: "ajoutez la colonne stock", speaker: "Vittorio" }],
        },
      ],
      mentionedTasks: [
        {
          taskId: done.id,
          taskTitle: "Export des prix",
          excerpts: [{ quote: "merci pour l'export des prix", speaker: "Vittorio" }],
        },
      ],
    });

    const r = await extractAndSaveEmailProposals(messageId);
    expect(r).toMatchObject({ skipped: false, count: 0 });
    const proposals = await db
      .select({ id: emailProposals.id })
      .from(emailProposals)
      .where(eq(emailProposals.messageId, messageId));
    expect(proposals).toHaveLength(0);
    const sources = await db
      .select({ relation: taskSources.relation, excerpt: taskSources.excerpt })
      .from(taskSources)
      .where(eq(taskSources.messageId, messageId));
    expect(sources).toEqual([{ relation: "mention", excerpt: "merci pour l'export des prix" }]);
    const [m] = await db
      .select({ meta: gmailMessages.extractionMeta })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, messageId));
    expect((m?.meta as { doneTasksSeen?: boolean } | null)?.doneTasksSeen).toBe(false);
  });
});

describe("fil déjà répondu", () => {
  async function threadWithReply() {
    const asked = await insertMessage({
      userId: actor.id,
      fromEmail: "m.frederic@gpasplus.com",
      subject: "Demande d'agrément CII",
      internalDate: new Date("2026-10-28T09:05:00Z"),
    });
    const [row] = await db
      .select({ threadId: gmailMessages.threadId })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, asked));
    const threadId = row?.threadId as string;
    await insertMessage({
      userId: actor.id,
      fromEmail: "pierreyves@automato.tech",
      subject: "Re: Demande d'agrément CII",
      threadId,
      internalDate: new Date("2026-10-28T11:19:00Z"),
      labels: ["SENT"],
    });
    return { asked, threadId };
  }

  it("la relève fait expirer « Répondre à X » et le brouillon, pas les autres tâches", async () => {
    const { asked } = await threadWithReply();
    const inserted = await db
      .insert(emailProposals)
      .values([
        {
          messageId: asked,
          kind: "task",
          payload: {
            title: "Répondre à Frédéric pour indiquer si l'on souhaite être mis en relation",
          },
        },
        {
          messageId: asked,
          kind: "task",
          payload: { title: "Faire la demande d'agrément CII pour Automato" },
        },
        { messageId: asked, kind: "draft_reply", payload: { subject: "Re:", body: "…" } },
      ])
      .returning({
        id: emailProposals.id,
        kind: emailProposals.kind,
        payload: emailProposals.payload,
      });

    expect(await expireAnsweredProposals(db, { userId: actor.id })).toBe(2);
    const byTitle: Record<string, string> = {};
    for (const row of inserted) {
      const [r] = await db
        .select({ status: emailProposals.status })
        .from(emailProposals)
        .where(eq(emailProposals.id, row.id));
      const key =
        row.kind === "draft_reply" ? "brouillon" : String((row.payload as { title: string }).title);
      byTitle[key] = r?.status ?? "?";
    }
    expect(byTitle).toEqual({
      "Répondre à Frédéric pour indiquer si l'on souhaite être mis en relation": "expired",
      "Faire la demande d'agrément CII pour Automato": "pending",
      brouillon: "expired",
    });
  });

  it("l'extraction d'un mail déjà répondu ne propose pas « Répondre » et n'attend plus de réponse", async () => {
    const { asked } = await threadWithReply();
    const task = (title: string) => ({
      title,
      dueDate: null,
      projectName: null,
      assigneeName: null,
      priority: null,
      kind: null,
      excerpts: [{ quote: "merci de me dire", speaker: "Frédéric" }],
    });
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      needsReply: true,
      proposedTasks: [
        task("Répondre à Frédéric sur Auditex"),
        task("Faire la demande d'agrément CII"),
      ],
    });

    await extractAndSaveEmailProposals(asked);

    const rows = await db
      .select({ payload: emailProposals.payload })
      .from(emailProposals)
      .where(and(eq(emailProposals.messageId, asked), eq(emailProposals.kind, "task")));
    expect(rows.map((r) => (r.payload as { title: string }).title)).toEqual([
      "Faire la demande d'agrément CII",
    ]);
    const [m] = await db
      .select({ meta: gmailMessages.extractionMeta })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, asked));
    expect((m?.meta as { needsReply?: boolean } | null)?.needsReply).toBe(false);
  });
});

describe("péremption", () => {
  it("expire les propositions en attente de plus de sept jours, du seul utilisateur visé", async () => {
    const mine = await insertMessage({ userId: actor.id, fromEmail: "vittorio@gpasplus.com" });
    const theirs = await insertMessage({ userId: other.id, fromEmail: "vittorio@gpasplus.com" });
    const inserted = await db
      .insert(emailProposals)
      .values([
        // Vieille et jamais tranchée : expire.
        {
          messageId: mine,
          kind: "task",
          payload: { title: "Vieille", projectId: null },
          createdAt: daysAgo(PROPOSAL_TTL_DAYS + 1),
        },
        // Récente : reste.
        {
          messageId: mine,
          kind: "task",
          payload: { title: "Récente", projectId: null },
          createdAt: daysAgo(2),
        },
        // Vieille mais tranchée : une décision ne se périme pas.
        {
          messageId: mine,
          kind: "task",
          payload: { title: "Acceptée", projectId: null },
          status: "accepted",
          decidedAt: daysAgo(8),
          createdAt: daysAgo(PROPOSAL_TTL_DAYS + 3),
        },
        // Vieille, en attente, mais chez un autre utilisateur.
        {
          messageId: theirs,
          kind: "task",
          payload: { title: "Pas à moi", projectId: null },
          createdAt: daysAgo(PROPOSAL_TTL_DAYS + 1),
        },
      ])
      .returning({ id: emailProposals.id, title: emailProposals.payload });

    const n = await expireStaleEmailProposals(db, { userId: actor.id });
    expect(n).toBe(1);

    const statusByTitle = new Map<string, string>();
    for (const row of inserted) {
      const [r] = await db
        .select({ status: emailProposals.status })
        .from(emailProposals)
        .where(eq(emailProposals.id, row.id));
      statusByTitle.set(String((row.title as { title: string }).title), r?.status ?? "?");
    }
    expect(Object.fromEntries(statusByTitle)).toEqual({
      Vieille: "expired",
      Récente: "pending",
      Acceptée: "accepted",
      "Pas à moi": "pending",
    });
  });

  it("une proposition née d'un mail de robot expire sans attendre", async () => {
    const robot = await insertMessage({
      userId: actor.id,
      fromEmail: "isabelle.tissot@dougs.fr",
      fromName: "Isabelle de Dougs",
      subject: "Votre société peut payer ces 10 dépenses à votre place",
    });
    const human = await insertMessage({ userId: actor.id, fromEmail: "vittorio@gpasplus.com" });
    const inserted = await db
      .insert(emailProposals)
      .values([
        { messageId: robot, kind: "entity", payload: { name: "Dougs" } },
        { messageId: human, kind: "task", payload: { title: "Export", projectId: null } },
      ])
      .returning({ id: emailProposals.id, messageId: emailProposals.messageId });

    expect(await expireAutomatedSenderProposals(db, { userId: actor.id })).toBe(1);
    const statuses = new Map<string, string>();
    for (const row of inserted) {
      const [r] = await db
        .select({ status: emailProposals.status })
        .from(emailProposals)
        .where(eq(emailProposals.id, row.id));
      statuses.set(row.messageId, r?.status ?? "?");
    }
    expect(statuses.get(robot)).toBe("expired");
    expect(statuses.get(human)).toBe("pending");
  });

  it("vaut aussi pour les réunions, sans distinction d'utilisateur", async () => {
    const [m] = await db
      .insert(meetings)
      .values({
        title: "Point Tech",
        occurredAt: new Date("2026-10-01T10:00:00Z"),
        createdBy: other.id,
      })
      .returning({ id: meetings.id });
    if (!m) throw new Error("insert meeting");
    await db.insert(meetingProposals).values([
      {
        meetingId: m.id,
        kind: "task",
        payload: { title: "Vieille" },
        createdAt: daysAgo(PROPOSAL_TTL_DAYS + 1),
      },
      { meetingId: m.id, kind: "task", payload: { title: "Récente" }, createdAt: daysAgo(1) },
    ]);

    expect(await expireStaleMeetingProposals(db)).toBe(1);

    const rows = await db
      .select({ payload: meetingProposals.payload, status: meetingProposals.status })
      .from(meetingProposals)
      .where(eq(meetingProposals.meetingId, m.id));
    expect(
      Object.fromEntries(rows.map((r) => [(r.payload as { title: string }).title, r.status])),
    ).toEqual({
      Vieille: "expired",
      Récente: "pending",
    });
  });

  it("une proposition périmée n'est pas un refus : la ré-extraction la repose", async () => {
    const messageId = await insertMessage({ userId: actor.id, fromEmail: "vittorio@gpasplus.com" });
    await db.insert(emailProposals).values([
      {
        messageId,
        kind: "task",
        payload: { title: "Export quotidien des prix", projectId: null },
        status: "expired",
        decidedAt: daysAgo(1),
        createdAt: daysAgo(9),
      },
      {
        messageId,
        kind: "task",
        payload: { title: "Relancer Bagheera", projectId: null },
        status: "rejected",
        decidedBy: actor.id,
        decidedAt: daysAgo(1),
        createdAt: daysAgo(9),
      },
    ]);
    const task = (title: string, quote: string) => ({
      title,
      dueDate: null,
      projectName: null,
      assigneeName: null,
      priority: null,
      kind: null,
      excerpts: [{ quote, speaker: "Vittorio Morino" }],
    });
    mockedExtractEmail.mockResolvedValueOnce({
      ...emptyEmailExtraction,
      proposedTasks: [
        task("Export quotidien des prix", "un export quotidien des prix"),
        task("Relancer Bagheera", "relancez Bagheera"),
      ],
    });

    await extractAndSaveEmailProposals(messageId);

    const rows = await db
      .select({ payload: emailProposals.payload, status: emailProposals.status })
      .from(emailProposals)
      .where(eq(emailProposals.messageId, messageId));
    const byTitle = Object.fromEntries(
      rows.map((r) => [(r.payload as { title: string }).title, r.status]),
    );
    // La périmée revient en attente (une seule ligne), le refus tient.
    expect(byTitle).toEqual({
      "Export quotidien des prix": "pending",
      "Relancer Bagheera": "rejected",
    });
    expect(rows).toHaveLength(2);
  });
});
