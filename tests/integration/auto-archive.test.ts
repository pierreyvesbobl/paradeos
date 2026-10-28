import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import {
  runAutoArchive,
  selectAutomatedThreads,
  selectDoneTaskThreads,
} from "@/lib/gmail/auto-archive";
import { modifyThreadLabels } from "@/lib/google/gmail-api";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * L'archivage automatique retire de la boîte ce qui n'y a plus sa place :
 * les fils dont les tâches sont terminées, les notifications de robots
 * anciennes. Gmail est simulé ; la sélection et la trace sont réelles.
 */

vi.mock("@/lib/google/gmail-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/google/gmail-api")>();
  return { ...original, modifyThreadLabels: vi.fn(async () => ({})) };
});
vi.mock("@/lib/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...original,
    getSetting: vi.fn(async (key: string) => (key === "GMAIL_ARCHIVE_AUTOMATED_DAYS" ? "7" : null)),
  };
});

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function insertThread(opts: {
  subject: string;
  messages: { from: string; at: Date; labels?: string[] }[];
  hasUnread?: boolean;
}) {
  const last = opts.messages.reduce(
    (m, x) => (x.at > m ? x.at : m),
    opts.messages[0]?.at ?? new Date(),
  );
  const [thread] = await db
    .insert(gmailThreads)
    .values({
      userId: actor.id,
      gmailThreadId: `gt-${crypto.randomUUID()}`,
      subject: opts.subject,
      lastMessageAt: last,
      hasUnread: opts.hasUnread ?? false,
      labels: ["INBOX"],
    })
    .returning({ id: gmailThreads.id });
  if (!thread) throw new Error("insert thread");
  const ids: string[] = [];
  for (const m of opts.messages) {
    const [row] = await db
      .insert(gmailMessages)
      .values({
        threadId: thread.id,
        userId: actor.id,
        gmailMessageId: `gm-${crypto.randomUUID()}`,
        fromEmail: m.from,
        subject: opts.subject,
        internalDate: m.at,
        labels: m.labels ?? ["INBOX"],
      })
      .returning({ id: gmailMessages.id });
    if (!row) throw new Error("insert message");
    ids.push(row.id);
  }
  return { threadId: thread.id, messageIds: ids };
}

async function linkTask(messageId: string, opts: { status: "todo" | "done"; completedAt?: Date }) {
  const [t] = await db
    .insert(tasks)
    .values({
      title: `Tâche ${crypto.randomUUID().slice(0, 8)}`,
      status: opts.status,
      completedAt: opts.completedAt ?? null,
      createdBy: actor.id,
    })
    .returning({ id: tasks.id });
  if (!t) throw new Error("insert task");
  await db.insert(taskSources).values({
    taskId: t.id,
    sourceKind: "email",
    messageId,
    relation: "mention",
    excerpt: "merci de livrer l'export",
    excerptFingerprint: crypto.randomUUID(),
  });
  return t.id;
}

describe("fils aux tâches terminées", () => {
  it("retient le fil lu dont la tâche est close après le dernier message, et lui seul", async () => {
    const done = await insertThread({
      subject: "Export",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(5) }],
    });
    await linkTask(done.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    const stillOpen = await insertThread({
      subject: "Prix",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(5) }],
    });
    await linkTask(stillOpen.messageIds[0] as string, { status: "todo" });

    const reopened = await insertThread({
      subject: "Relance",
      messages: [
        { from: "vittorio@gpasplus.com", at: daysAgo(5) },
        { from: "vittorio@gpasplus.com", at: daysAgo(1) },
      ],
    });
    await linkTask(reopened.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    const unread = await insertThread({
      subject: "Non lu",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(5) }],
      hasUnread: true,
    });
    await linkTask(unread.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    const picked = await selectDoneTaskThreads(db, { userId: actor.id });
    const ids = new Set(picked.map((c) => c.threadId));
    expect(ids.has(done.threadId)).toBe(true);
    expect(ids.has(stillOpen.threadId)).toBe(false);
    expect(ids.has(reopened.threadId)).toBe(false);
    expect(ids.has(unread.threadId)).toBe(false);
  });
});

describe("notifications de robots", () => {
  it("retient les fils sans humain au-delà de l'âge, ni humain ni agenda", async () => {
    const old = await insertThread({
      subject: "Reçu",
      messages: [{ from: "notifications@stripe.com", at: daysAgo(10) }],
      hasUnread: true,
    });
    const recent = await insertThread({
      subject: "Alerte",
      messages: [{ from: "noreply@supabase.com", at: daysAgo(2) }],
    });
    const withHuman = await insertThread({
      subject: "Facture",
      messages: [
        { from: "noreply@qonto.com", at: daysAgo(12) },
        { from: "comptable@cabinet.fr", at: daysAgo(10) },
      ],
    });
    const reminder = await insertThread({
      subject: "Notification: Faire les volets sociaux - dim. 25 oct. 2026 11:00",
      messages: [{ from: "calendar-notification@google.com", at: daysAgo(20) }],
    });
    const booking = await insertThread({
      subject: "Rendez-vous de 30 min between Pierre-Yves Sage and mamura",
      messages: [{ from: "hello@cal.com", at: daysAgo(20) }],
    });

    const picked = await selectAutomatedThreads(db, { userId: actor.id, days: 7 });
    const ids = new Set(picked.map((c) => c.threadId));
    expect(ids.has(old.threadId)).toBe(true);
    expect(ids.has(recent.threadId)).toBe(false);
    expect(ids.has(withHuman.threadId)).toBe(false);
    // Un rappel d'agenda ou une confirmation de rendez-vous reste en boîte.
    expect(ids.has(reminder.threadId)).toBe(false);
    expect(ids.has(booking.threadId)).toBe(false);
  });
});

describe("relève", () => {
  it("archive côté Gmail, pose la trace, et ne reprend pas un fil remis en boîte", async () => {
    const t = await insertThread({
      subject: "Vieille alerte",
      messages: [{ from: "alerting-noreply@google.com", at: daysAgo(30) }],
    });
    vi.mocked(modifyThreadLabels).mockClear();

    const r = await runAutoArchive({ userId: actor.id, accessToken: "token" });
    expect(r.errors).toEqual([]);
    expect(r.archived).toBeGreaterThanOrEqual(1);
    const calls = vi.mocked(modifyThreadLabels).mock.calls.map((c) => c[2]);
    expect(calls.some((c) => c.removeLabelIds?.includes("INBOX"))).toBe(true);

    const [thread] = await db
      .select({
        at: gmailThreads.autoArchivedAt,
        reason: gmailThreads.autoArchiveReason,
        labels: gmailThreads.labels,
      })
      .from(gmailThreads)
      .where(eq(gmailThreads.id, t.threadId));
    expect(thread?.reason).toBe("automated");
    expect(thread?.at).toBeTruthy();
    expect(thread?.labels).not.toContain("INBOX");

    // L'utilisateur le remet en boîte : la règle ne le reprend pas.
    await db
      .update(gmailMessages)
      .set({ labels: ["INBOX"] })
      .where(eq(gmailMessages.threadId, t.threadId));
    const again = await selectAutomatedThreads(db, { userId: actor.id, days: 7 });
    expect(again.some((c) => c.threadId === t.threadId)).toBe(false);
  });
});
