import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { expireStaleEmailProposals, PROPOSAL_TTL_DAYS } from "@/lib/gmail/expire-proposals";
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
}) {
  const subject = opts.subject ?? "Sujet";
  const [thread] = await db
    .insert(gmailThreads)
    .values({ userId: opts.userId, gmailThreadId: `gt-${crypto.randomUUID()}`, subject })
    .returning({ id: gmailThreads.id });
  if (!thread) throw new Error("insert thread");
  const [msg] = await db
    .insert(gmailMessages)
    .values({
      threadId: thread.id,
      userId: opts.userId,
      gmailMessageId: `gm-${crypto.randomUUID()}`,
      fromEmail: opts.fromEmail,
      fromName: opts.fromName ?? null,
      subject,
      bodyText: "Corps du message.",
      internalDate: new Date("2026-10-20T09:00:00Z"),
      extractionStatus: "pending",
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
