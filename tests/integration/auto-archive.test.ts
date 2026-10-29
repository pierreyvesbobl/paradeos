import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { gmailMessages, gmailTags, gmailThreads, gmailThreadTags } from "@/db/schema/gmail";
import { projects } from "@/db/schema/projects";
import { taskSources } from "@/db/schema/task-sources";
import { tasks } from "@/db/schema/tasks";
import {
  reconcileInboxMirror,
  requeueThreadsForDoneTasks,
  runAutoArchive,
  selectAutomatedThreads,
  selectDoneTaskThreads,
} from "@/lib/gmail/auto-archive";
import { listThreadsByLabel, modifyThreadLabels } from "@/lib/google/gmail-api";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * L'archivage automatique retire de la boîte ce qui n'y a plus sa place :
 * les fils dont les tâches sont terminées, les notifications de robots
 * anciennes. Gmail est simulé ; la sélection et la trace sont réelles.
 */

vi.mock("@/lib/google/gmail-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/google/gmail-api")>();
  return {
    ...original,
    modifyThreadLabels: vi.fn(async () => ({})),
    // Par défaut, Gmail confirme tout ce que le miroir croit en boîte.
    listThreadsByLabel: vi.fn(async () => ({ threads: [], nextPageToken: undefined })),
  };
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
  messages: {
    from: string;
    at: Date;
    labels?: string[];
    needsReply?: boolean;
    extracted?: boolean;
    meta?: Record<string, unknown>;
  }[];
  hasUnread?: boolean;
}) {
  const last = opts.messages.reduce(
    (m, x) => (x.at > m ? x.at : m),
    opts.messages[0]?.at ?? new Date(),
  );
  const gmailThreadId = `gt-${crypto.randomUUID()}`;
  const [thread] = await db
    .insert(gmailThreads)
    .values({
      userId: actor.id,
      gmailThreadId,
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
        bodyText: "Corps du message.",
        extractionStatus: m.extracted ? "extracted" : "skipped",
        extractionMeta:
          m.needsReply === undefined && !m.meta
            ? null
            : {
                ...(m.meta ?? {}),
                ...(m.needsReply === undefined ? {} : { needsReply: m.needsReply }),
              },
      })
      .returning({ id: gmailMessages.id });
    if (!row) throw new Error("insert message");
    ids.push(row.id);
  }
  return { threadId: thread.id, gmailThreadId, messageIds: ids };
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
  it("retient le fil lu dont les tâches sont closes, sauf s'il attend encore quelque chose", async () => {
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

    // Un merci arrivé après la clôture, extrait, sans réponse attendue : le fil part.
    const thanked = await insertThread({
      subject: "Re: Export",
      messages: [
        { from: "vittorio@gpasplus.com", at: daysAgo(5), extracted: true },
        { from: "vittorio@gpasplus.com", at: daysAgo(1), extracted: true, needsReply: false },
      ],
    });
    await linkTask(thanked.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    // Même chose, mais le dernier message n'est pas encore extrait : on ne sait pas, il reste.
    const reopened = await insertThread({
      subject: "Relance",
      messages: [
        { from: "vittorio@gpasplus.com", at: daysAgo(5), extracted: true },
        { from: "vittorio@gpasplus.com", at: daysAgo(1) },
      ],
    });
    await db
      .update(gmailMessages)
      .set({ extractionStatus: "pending" })
      .where(eq(gmailMessages.id, reopened.messageIds[1] as string));
    await linkTask(reopened.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    const unread = await insertThread({
      subject: "Non lu",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(5) }],
      hasUnread: true,
    });
    await linkTask(unread.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    const awaiting = await insertThread({
      subject: "Export : peux-tu confirmer le format ?",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(5), needsReply: true }],
    });
    await linkTask(awaiting.messageIds[0] as string, { status: "done", completedAt: daysAgo(3) });

    const picked = await selectDoneTaskThreads(db, { userId: actor.id });
    const ids = new Set(picked.map((c) => c.threadId));
    expect(ids.has(done.threadId)).toBe(true);
    expect(ids.has(stillOpen.threadId)).toBe(false);
    expect(ids.has(thanked.threadId)).toBe(true);
    expect(ids.has(reopened.threadId)).toBe(false);
    expect(ids.has(unread.threadId)).toBe(false);
    // Tâche close, mais le mail attend une réponse : il reste.
    expect(ids.has(awaiting.threadId)).toBe(false);
  });
});

describe("rattrapage des fils sans lien de tâche", () => {
  it("remet en file le dernier message d'un fil tagué à un projet aux tâches terminées, une fois", async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: "GpasPlus", kind: "client", status: "active" })
      .returning({ id: projects.id });
    if (!project) throw new Error("insert project");
    await db.insert(tasks).values({
      title: "Export des prix",
      status: "done",
      completedAt: daysAgo(10),
      projectId: project.id,
      createdBy: actor.id,
    });
    const [tag] = await db
      .insert(gmailTags)
      .values({
        userId: actor.id,
        kind: "project",
        targetId: project.id,
        labelName: "Paradeos/Projets/GpasPlus",
      })
      .returning({ id: gmailTags.id });
    if (!tag) throw new Error("insert tag");

    const t = await insertThread({
      subject: "Merci pour l'export",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(4), extracted: true }],
    });
    await db.insert(gmailThreadTags).values({ threadId: t.threadId, tagId: tag.id });

    expect(await requeueThreadsForDoneTasks(db, { userId: actor.id })).toBe(1);
    const [m] = await db
      .select({ status: gmailMessages.extractionStatus, meta: gmailMessages.extractionMeta })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, t.messageIds[0] as string));
    expect(m?.status).toBe("pending");
    expect((m?.meta as { requeuedForDoneTasks?: boolean } | null)?.requeuedForDoneTasks).toBe(true);
    // Déjà en file : pas rejoué une seconde fois.
    expect(await requeueThreadsForDoneTasks(db, { userId: actor.id })).toBe(0);
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
    const failedPayment = await insertThread({
      subject: "Votre paiement a échoué : action requise",
      messages: [{ from: "notifications@stripe.com", at: daysAgo(20) }],
    });

    const picked = await selectAutomatedThreads(db, { userId: actor.id, days: 7 });
    const ids = new Set(picked.map((c) => c.threadId));
    expect(ids.has(old.threadId)).toBe(true);
    expect(ids.has(recent.threadId)).toBe(false);
    expect(ids.has(withHuman.threadId)).toBe(false);
    // Un rappel d'agenda ou une confirmation de rendez-vous reste en boîte.
    expect(ids.has(reminder.threadId)).toBe(false);
    expect(ids.has(booking.threadId)).toBe(false);
    // Un robot qui demande un geste reste aussi.
    expect(ids.has(failedPayment.threadId)).toBe(false);
  });
});

describe("miroir de la boîte", () => {
  it("retire INBOX localement aux fils que Gmail n'a plus en boîte, et ne touche à rien si la liste est incomplète", async () => {
    const kept = await insertThread({
      subject: "Toujours en boîte",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(3) }],
    });
    const gone = await insertThread({
      subject: "Rangé à la main dans Gmail",
      messages: [{ from: "vittorio@gpasplus.com", at: daysAgo(40) }],
    });

    // Liste incomplète (page suivante annoncée au-delà du plafond) : rien ne bouge.
    vi.mocked(listThreadsByLabel).mockResolvedValue({ threads: [], nextPageToken: "encore" });
    const partial = await reconcileInboxMirror(db, { userId: actor.id, accessToken: "token" });
    expect(partial.complete).toBe(false);

    vi.mocked(listThreadsByLabel).mockImplementation(async () => ({
      threads: [{ id: kept.gmailThreadId }],
      nextPageToken: undefined,
    }));
    const r = await reconcileInboxMirror(db, { userId: actor.id, accessToken: "token" });
    expect(r.complete).toBe(true);
    expect(r.forgotten).toBeGreaterThanOrEqual(1);

    const labelsOf = async (threadId: string) =>
      (
        await db
          .select({ labels: gmailMessages.labels })
          .from(gmailMessages)
          .where(eq(gmailMessages.threadId, threadId))
      ).map((m) => m.labels);
    expect((await labelsOf(gone.threadId)).every((l) => !l.includes("INBOX"))).toBe(true);
    expect((await labelsOf(kept.threadId)).some((l) => l.includes("INBOX"))).toBe(true);
    // Restaure le comportement neutre pour les tests suivants.
    vi.mocked(listThreadsByLabel).mockImplementation(async () => ({
      threads: [],
      nextPageToken: "plafond",
    }));
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
