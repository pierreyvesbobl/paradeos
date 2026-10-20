import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { candidatureReplies } from "@/db/schema/candidature-replies";
import { gmailMessages, gmailTags, gmailThreads, gmailThreadTags } from "@/db/schema/gmail";
import { classifyCandidature } from "@/lib/gmail/candidature-classify";
import {
  processCandidatureReply,
  queueCandidature,
  recoverMissedCandidatures,
} from "@/lib/gmail/candidature-filer";
import { modifyThreadLabels, sendGmailMessage } from "@/lib/google/gmail-api";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Tout ce qui sort vers Gmail ou vers le LLM est simulé ; la base, les
 * gardes (fil déjà traité, mail trop vieux, confiance faible), le journal
 * et le libellé sont réels.
 */
vi.mock("@/lib/google/account", () => ({
  getValidAccessToken: vi.fn(async () => "token"),
}));

vi.mock("@/lib/google/gmail-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/google/gmail-api")>();
  return {
    ...original,
    getMessage: vi.fn(async () => ({
      id: "gm-1",
      threadId: "gt-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<orig@mail.gmail.com>" },
          { name: "From", value: "Candice DUPUIS <candice@example.com>" },
        ],
      },
    })),
    sendGmailMessage: vi.fn(async () => ({ id: "sent-1", threadId: "gt-1" })),
    modifyThreadLabels: vi.fn(async () => ({})),
    listLabels: vi.fn(async () => []),
    createLabel: vi.fn(async (_token: string, args: { name: string }) => ({
      id: `label-${args.name}`,
      name: args.name,
    })),
  };
});

vi.mock("@/lib/gmail/candidature-classify", () => ({
  classifyCandidature: vi.fn(async () => ({
    isCandidature: true,
    confidence: 0.95,
    firstName: "Candice",
    language: "fr",
    summary: "Alternance IA & automatisation à partir de novembre.",
  })),
}));

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

async function createThread(gmailThreadId: string) {
  const [row] = await db
    .insert(gmailThreads)
    .values({ userId: actor.id, gmailThreadId, subject: "Candidature spontanée" })
    .returning({ id: gmailThreads.id });
  if (!row) throw new Error("insert thread");
  return row.id;
}

async function createMessage(args: {
  threadId: string;
  gmailMessageId: string;
  fromEmail?: string;
  fromName?: string | null;
  bodyText?: string | null;
  internalDate?: Date;
  labels?: string[];
  subject?: string;
}) {
  const [row] = await db
    .insert(gmailMessages)
    .values({
      threadId: args.threadId,
      userId: actor.id,
      gmailMessageId: args.gmailMessageId,
      // Une adresse par message par défaut : la garde « même candidat »
      // isolerait sinon les tests les uns des autres.
      fromEmail: args.fromEmail ?? `candidat-${args.gmailMessageId}@example.com`,
      fromName: args.fromName === undefined ? "Candice DUPUIS" : args.fromName,
      subject: args.subject ?? "Candidature spontanée – Alternance IA & automatisation",
      bodyText:
        args.bodyText === undefined
          ? "Bonjour,\n\nJe me permets de vous adresser ma candidature pour une alternance.\n\nCandice"
          : args.bodyText,
      internalDate: args.internalDate ?? new Date(),
      labels: args.labels ?? ["INBOX", "UNREAD"],
    })
    .returning({ id: gmailMessages.id });
  if (!row) throw new Error("insert message");
  return row.id;
}

async function queue(threadId: string, messageId: string) {
  const [msg] = await db
    .select({ fromEmail: gmailMessages.fromEmail, fromName: gmailMessages.fromName })
    .from(gmailMessages)
    .where(eq(gmailMessages.id, messageId));
  await queueCandidature({
    userId: actor.id,
    messageIdLocal: messageId,
    threadIdLocal: threadId,
    fromEmail: msg?.fromEmail ?? null,
    fromName: msg?.fromName ?? null,
  });
  const [row] = await db
    .select({ id: candidatureReplies.id })
    .from(candidatureReplies)
    .where(eq(candidatureReplies.messageId, messageId));
  if (!row) throw new Error("queue");
  return row.id;
}

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

beforeEach(() => {
  vi.mocked(sendGmailMessage).mockClear();
  vi.mocked(modifyThreadLabels).mockClear();
  vi.mocked(classifyCandidature).mockClear();
});

describe("agent candidatures", () => {
  it("répond dans le fil, libelle et archive", async () => {
    const threadId = await createThread("gt-1");
    const messageId = await createMessage({
      threadId,
      gmailMessageId: "gm-1",
      fromEmail: "candice@example.com",
    });
    const replyId = await queue(threadId, messageId);

    const outcome = await processCandidatureReply(replyId);
    expect(outcome.status).toBe("replied");

    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
    const [, sent] = vi.mocked(sendGmailMessage).mock.calls[0] ?? [];
    expect(sent?.to).toBe("candice@example.com");
    expect(sent?.subject).toBe("Re: Candidature spontanée – Alternance IA & automatisation");
    expect(sent?.gmailThreadId).toBe("gt-1");
    expect(sent?.inReplyToHeader).toBe("<orig@mail.gmail.com>");
    expect(sent?.body.startsWith("Bonjour Candice,")).toBe(true);
    expect(sent?.body).toContain("aucun poste ouvert");

    const [row] = await db
      .select()
      .from(candidatureReplies)
      .where(eq(candidatureReplies.id, replyId));
    expect(row?.status).toBe("replied");
    expect(row?.sentGmailMessageId).toBe("sent-1");
    expect(row?.repliedAt).not.toBeNull();
    expect(row?.reason).toContain("Alternance");

    // Libellé système posé en base et poussé dans Gmail.
    const [tag] = await db
      .select({ labelName: gmailTags.labelName })
      .from(gmailThreadTags)
      .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
      .where(eq(gmailThreadTags.threadId, threadId));
    expect(tag?.labelName).toBe("Paradeos/Candidature");
    const labelCalls = vi.mocked(modifyThreadLabels).mock.calls.map((c) => c[2]);
    expect(labelCalls).toContainEqual({ addLabelIds: ["label-Paradeos/Candidature"] });
    expect(labelCalls).toContainEqual({ removeLabelIds: ["INBOX"] });

    // Miroir local : le fil a quitté la boîte de réception.
    const [msg] = await db
      .select({ labels: gmailMessages.labels })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, messageId));
    expect(msg?.labels).not.toContain("INBOX");
  });

  it("une relance dans le même fil ne reçoit pas de seconde réponse", async () => {
    const threadId = await createThread("gt-2");
    const first = await createMessage({ threadId, gmailMessageId: "gm-2a" });
    const firstReply = await queue(threadId, first);
    await processCandidatureReply(firstReply);
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);

    const relance = await createMessage({
      threadId,
      gmailMessageId: "gm-2b",
      subject: "Re: Candidature spontanée – Alternance IA & automatisation",
    });
    const relanceReply = await queue(threadId, relance);
    const outcome = await processCandidatureReply(relanceReply);
    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toBe("fil déjà répondu.");
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
    expect(classifyCandidature).toHaveBeenCalledTimes(1);
  });

  it("le même candidat dans un nouveau fil n'est pas répondu deux fois", async () => {
    const threadA = await createThread("gt-2c");
    const first = await createMessage({
      threadId: threadA,
      gmailMessageId: "gm-2c",
      fromEmail: "zen@example.com",
    });
    await processCandidatureReply(await queue(threadA, first));
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);

    const threadB = await createThread("gt-2d");
    const second = await createMessage({
      threadId: threadB,
      gmailMessageId: "gm-2d",
      fromEmail: "zen@example.com",
      subject: "Candidature actualisée",
    });
    const outcome = await processCandidatureReply(await queue(threadB, second));
    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toContain("candidat déjà répondu");
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
  });

  it("n'envoie rien quand le LLM n'y voit pas une candidature", async () => {
    vi.mocked(classifyCandidature).mockResolvedValueOnce({
      isCandidature: false,
      confidence: 0.9,
      firstName: null,
      language: "fr",
      summary: "Freelance qui propose ses services.",
    });
    const threadId = await createThread("gt-3");
    const messageId = await createMessage({ threadId, gmailMessageId: "gm-3" });
    const replyId = await queue(threadId, messageId);

    const outcome = await processCandidatureReply(replyId);
    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toContain("pas une candidature");
    expect(sendGmailMessage).not.toHaveBeenCalled();
    expect(modifyThreadLabels).not.toHaveBeenCalled();
  });

  it("n'envoie rien quand le LLM hésite", async () => {
    vi.mocked(classifyCandidature).mockResolvedValueOnce({
      isCandidature: true,
      confidence: 0.5,
      firstName: null,
      language: "fr",
      summary: "Peut-être une candidature.",
    });
    const threadId = await createThread("gt-4");
    const messageId = await createMessage({ threadId, gmailMessageId: "gm-4" });
    const replyId = await queue(threadId, messageId);

    const outcome = await processCandidatureReply(replyId);
    expect(outcome.status).toBe("rejected");
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });

  it("écarte un mail de plus de 30 jours sans appeler le LLM", async () => {
    const threadId = await createThread("gt-5");
    const messageId = await createMessage({
      threadId,
      gmailMessageId: "gm-5",
      internalDate: new Date(Date.now() - 45 * 86_400_000),
    });
    const replyId = await queue(threadId, messageId);

    const outcome = await processCandidatureReply(replyId);
    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toContain("30 jours");
    expect(classifyCandidature).not.toHaveBeenCalled();
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });

  it("écarte un fil où nous avons déjà écrit", async () => {
    const threadId = await createThread("gt-6");
    const messageId = await createMessage({ threadId, gmailMessageId: "gm-6a" });
    await createMessage({
      threadId,
      gmailMessageId: "gm-6b",
      fromEmail: "pierreyves@automato.tech",
      fromName: "Pierre-Yves",
      labels: ["SENT"],
    });
    const replyId = await queue(threadId, messageId);

    const outcome = await processCandidatureReply(replyId);
    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toBe("nous avons déjà écrit dans ce fil.");
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });

  it("passe en erreur sans corps, et reste reprenable", async () => {
    const threadId = await createThread("gt-7");
    const messageId = await createMessage({ threadId, gmailMessageId: "gm-7", bodyText: null });
    const replyId = await queue(threadId, messageId);

    const outcome = await processCandidatureReply(replyId);
    expect(outcome.status).toBe("error");
    expect(outcome.reason).toBe("corps du mail absent.");
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });

  it("rattrape les mails déjà en base en métadonnées seules", async () => {
    const threadId = await createThread("gt-8");
    const metaOnly = await createMessage({
      threadId,
      gmailMessageId: "gm-8a",
      bodyText: null,
      subject: "Demande de stage de fin d'études",
    });
    await createMessage({
      threadId: await createThread("gt-9"),
      gmailMessageId: "gm-9",
      subject: "Demande devis formation",
    });
    const fetched: string[] = [];

    const r = await recoverMissedCandidatures({
      userId: actor.id,
      labelNamesById: new Map(),
      limit: 10,
      fetchBody: async (id) => {
        fetched.push(id);
      },
    });
    expect(r.queued).toBe(1);
    expect(fetched).toEqual(["gm-8a"]);
    const [row] = await db
      .select({ status: candidatureReplies.status })
      .from(candidatureReplies)
      .where(eq(candidatureReplies.messageId, metaOnly));
    expect(row?.status).toBe("pending");

    // Idempotent : un second passage ne remet rien en file.
    const again = await recoverMissedCandidatures({
      userId: actor.id,
      labelNamesById: new Map(),
      limit: 10,
      fetchBody: async () => {},
    });
    expect(again.queued).toBe(0);
  });
});
