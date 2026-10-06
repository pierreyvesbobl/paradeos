import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { appSettings } from "@/db/schema/app-settings";
import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { tasks } from "@/db/schema/tasks";
import { sendDueCoworkingInvoices } from "@/lib/actions/coworking";
import { deliverDocumentEmail } from "@/lib/billing/deliver-document";
import { pushDougsSalesInvoiceDraft } from "@/lib/billing/dougs-push";
import { autoSendCoworkingInvoice } from "@/lib/coworking/auto-send";
import {
  canFinalizeDougsSalesInvoice,
  deleteDougsSalesInvoiceDraft,
  finalizeDougsSalesInvoice,
} from "@/lib/dougs/client";
import { SETTING_KEYS } from "@/lib/settings";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Tout ce qui sort vers Dougs ou vers la boîte mail est simulé ; la base,
 * les gardes, les transitions d'état et les traces (tâche de blocage,
 * erreurs notées sur la facture) sont réelles.
 */
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const FINAL_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/billing/dougs-push", () => ({
  resolveDougsClientData: vi.fn(async () => ({ id: "client-dougs" })),
  pushDougsSalesInvoiceDraft: vi.fn(async () => ({ id: DRAFT_ID, reference: "BROUILLON" })),
}));

vi.mock("@/lib/billing/deliver-document", () => ({
  deliverDocumentEmail: vi.fn(async () => ({ via: "parade" as const })),
}));

vi.mock("@/lib/dougs/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dougs/client")>();
  return {
    ...original,
    canFinalizeDougsSalesInvoice: vi.fn(async () => []),
    deleteDougsSalesInvoiceDraft: vi.fn(async () => undefined),
    finalizeDougsSalesInvoice: vi.fn(async () => ({
      id: DRAFT_ID,
      salesInvoiceId: FINAL_ID,
      reference: "F-2026-0042",
    })),
    getDougsSalesInvoice: vi.fn(async () => ({
      id: FINAL_ID,
      reference: "F-2026-0042",
      totalNetAmount: 500,
      totalVatAmount: 100,
      totalAmountWithVat: 600,
      status: "waiting",
    })),
  };
});

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

async function setGlobalAutoSend(enabled: boolean) {
  await db
    .insert(appSettings)
    .values({ key: SETTING_KEYS.COWORKING_AUTOSEND_ENABLED, value: String(enabled) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(enabled) } });
}

async function createCoworker(email: string | null) {
  const [row] = await db
    .insert(contacts)
    .values({ firstName: "Camille", lastName: "Durand", email })
    .returning({ id: contacts.id });
  if (!row) throw new Error("insert contact");
  return row.id;
}

async function createContractWithInvoice(opts: {
  autoSend?: boolean;
  billedBy?: "parade" | "g_and_o";
  email?: string | null;
  invoice?: Partial<typeof invoices.$inferInsert>;
}) {
  const contactId = await createCoworker(
    opts.email === undefined ? "camille@example.test" : opts.email,
  );
  const [contract] = await db
    .insert(coworkingContracts)
    .values({
      name: `Contrat ${crypto.randomUUID().slice(0, 6)}`,
      contactId,
      startDate: "2026-09-01",
      desks: 2,
      unitPriceHt: "250.00",
      billingFrequency: "monthly",
      autoSend: opts.autoSend ?? true,
      billedBy: opts.billedBy ?? "parade",
      createdBy: actor.id,
    })
    .returning({ id: coworkingContracts.id, name: coworkingContracts.name });
  if (!contract) throw new Error("insert contrat");
  const [invoice] = await db
    .insert(invoices)
    .values({
      kind: "coworking",
      brand: "coworking",
      coworkingContractId: contract.id,
      label: "septembre 2026",
      amountHt: "500.00",
      vatRate: "0.2",
      status: "draft",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      desks: 2,
      unitPriceHt: "250.00",
      billedBy: opts.billedBy ?? "parade",
      createdBy: actor.id,
      ...opts.invoice,
    })
    .returning({ id: invoices.id });
  if (!invoice) throw new Error("insert facture");
  return { contract, invoiceId: invoice.id };
}

async function invoiceById(id: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!row) throw new Error("facture introuvable");
  return row;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  actor = await seedUser(db, { role: "admin" });
  actAs(actor);
  process.env.COWORKING_AUTOSEND_ENABLED = undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

describe("autoSendCoworkingInvoice — gardes, sans toucher à Dougs", () => {
  it("réglage global absent : rien ne part", async () => {
    const { invoiceId } = await createContractWithInvoice({});
    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(res).toEqual({ ok: true, sent: false, reason: "disabled" });
    expect(pushDougsSalesInvoiceDraft).not.toHaveBeenCalled();
  });

  it("réglage global à false : idem", async () => {
    await setGlobalAutoSend(false);
    const { invoiceId } = await createContractWithInvoice({});
    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(res).toEqual({ ok: true, sent: false, reason: "disabled" });
  });

  it("contrat non opt-in, G&O, sans destinataire : chaque garde répond en premier", async () => {
    await setGlobalAutoSend(true);
    const notOptedIn = await createContractWithInvoice({ autoSend: false });
    const gAndO = await createContractWithInvoice({ billedBy: "g_and_o" });
    const noEmail = await createContractWithInvoice({ email: null });

    expect(
      await autoSendCoworkingInvoice({ userId: actor.id, invoiceId: notOptedIn.invoiceId }),
    ).toEqual({ ok: true, sent: false, reason: "not_opted_in" });
    expect(
      await autoSendCoworkingInvoice({ userId: actor.id, invoiceId: gAndO.invoiceId }),
    ).toEqual({ ok: true, sent: false, reason: "g_and_o" });
    expect(
      await autoSendCoworkingInvoice({ userId: actor.id, invoiceId: noEmail.invoiceId }),
    ).toEqual({ ok: true, sent: false, reason: "no_recipient" });

    expect(pushDougsSalesInvoiceDraft).not.toHaveBeenCalled();
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();
    expect(deliverDocumentEmail).not.toHaveBeenCalled();
    for (const { invoiceId } of [notOptedIn, gAndO, noEmail]) {
      expect((await invoiceById(invoiceId)).status).toBe("draft");
    }
  });

  it("refuse une facture qui n'est pas coworking", async () => {
    await setGlobalAutoSend(true);
    const { contract } = await createContractWithInvoice({});
    const [oneOff] = await db
      .insert(invoices)
      .values({
        kind: "one_off",
        brand: "coworking",
        coworkingContractId: contract.id,
        label: "Hors contrat",
        amountHt: "100.00",
        createdBy: actor.id,
      })
      .returning({ id: invoices.id });
    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId: oneOff?.id ?? "" });
    expect(res).toMatchObject({
      ok: false,
      message: expect.stringMatching(/pas de type coworking/),
    });
  });
});

describe("autoSendCoworkingInvoice — chemin complet", () => {
  it("brouillon → contrôle → finalisation → mail, et la facture passe en émise", async () => {
    await setGlobalAutoSend(true);
    const { invoiceId } = await createContractWithInvoice({});
    const before = Date.now();

    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(res).toEqual({
      ok: true,
      sent: true,
      reference: "F-2026-0042",
      to: ["camille@example.test"],
    });

    expect(pushDougsSalesInvoiceDraft).toHaveBeenCalledTimes(1);
    expect(canFinalizeDougsSalesInvoice).toHaveBeenCalledWith(actor.id, DRAFT_ID);
    expect(finalizeDougsSalesInvoice).toHaveBeenCalledWith(actor.id, DRAFT_ID);
    expect(deliverDocumentEmail).toHaveBeenCalledTimes(1);
    expect(deliverDocumentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: FINAL_ID, // l'id de la facture émise, pas celui du brouillon
        documentKind: "invoice",
        recipient: "camille@example.test",
        reference: "F-2026-0042",
        brand: "coworking",
        archiveInvoiceId: invoiceId,
      }),
    );

    const row = await invoiceById(invoiceId);
    expect(row.status).toBe("sent");
    expect(row.dougsInvoiceId).toBe(FINAL_ID);
    expect(row.dougsReference).toBe("F-2026-0042");
    expect(row.dougsStatus).toBe("WAITING");
    expect(row.dougsTotalHt).toBe("500.00");
    expect(row.dougsTotalTtc).toBe("600.00");
    expect(row.invoicedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.dueDate).not.toBeNull();
    expect(row.autoSentAt).not.toBeNull();
    expect(row.autoSendError).toBeNull();
  });

  it("une facture déjà partie ne repart jamais", async () => {
    await setGlobalAutoSend(true);
    const { invoiceId } = await createContractWithInvoice({});
    await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    vi.clearAllMocks();

    const again = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(again).toEqual({ ok: true, sent: false, reason: "already_sent" });
    expect(pushDougsSalesInvoiceDraft).not.toHaveBeenCalled();
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();
    expect(deliverDocumentEmail).not.toHaveBeenCalled();
  });

  it("blocage can-finalize : pas de finalisation, erreur notée, tâche créée", async () => {
    await setGlobalAutoSend(true);
    vi.mocked(canFinalizeDougsSalesInvoice).mockResolvedValueOnce([
      { field: "client.address", message: "Adresse du client manquante" },
    ]);
    const { invoiceId, contract } = await createContractWithInvoice({});

    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(res).toMatchObject({ ok: true, sent: false, reason: "blockers" });
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();
    expect(deliverDocumentEmail).not.toHaveBeenCalled();

    const row = await invoiceById(invoiceId);
    expect(row.status).toBe("draft");
    expect(row.dougsInvoiceId).toBe(DRAFT_ID); // le brouillon est tracé
    expect(row.dougsStatus).toBe("DRAFT");
    expect(row.autoSendError).toContain("Adresse du client manquante");

    const [task] = await db.select().from(tasks).where(eq(tasks.priority, "high"));
    expect(task?.title).toContain(contract.name);
    expect(task?.description).toContain("client.address");
  });

  it("à blanc : s'arrête avant la finalisation et ne laisse rien chez Dougs", async () => {
    await setGlobalAutoSend(true);
    const { invoiceId } = await createContractWithInvoice({});

    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId, dryRun: true });
    expect(res).toEqual({ ok: true, sent: false, reason: "dry_run" });
    expect(deleteDougsSalesInvoiceDraft).toHaveBeenCalledWith(actor.id, DRAFT_ID);
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();

    const row = await invoiceById(invoiceId);
    expect(row.status).toBe("draft");
    expect(row.dougsInvoiceId).toBeNull();
    expect(row.dougsStatus).toBeNull();
  });

  it("émise mais mail jamais parti : n'envoie que le mail, sans refinaliser", async () => {
    await setGlobalAutoSend(true);
    const { invoiceId } = await createContractWithInvoice({
      invoice: {
        status: "sent",
        dougsInvoiceId: FINAL_ID,
        dougsReference: "F-2026-0007",
        dougsStatus: "WAITING",
      },
    });

    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(res).toEqual({
      ok: true,
      sent: true,
      reference: "F-2026-0007",
      to: ["camille@example.test"],
    });
    expect(pushDougsSalesInvoiceDraft).not.toHaveBeenCalled();
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();
    expect(deliverDocumentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: FINAL_ID, reference: "F-2026-0007" }),
    );
    expect((await invoiceById(invoiceId)).autoSentAt).not.toBeNull();
  });

  it("mail en échec après finalisation : la facture reste émise, l'erreur est visible", async () => {
    await setGlobalAutoSend(true);
    vi.mocked(deliverDocumentEmail).mockRejectedValueOnce(new Error("SMTP indisponible"));
    const { invoiceId } = await createContractWithInvoice({});

    const res = await autoSendCoworkingInvoice({ userId: actor.id, invoiceId });
    expect(res).toMatchObject({
      ok: false,
      message: expect.stringMatching(/émise mais mail non envoyé/),
    });

    const row = await invoiceById(invoiceId);
    expect(row.status).toBe("sent");
    expect(row.dougsInvoiceId).toBe(FINAL_ID);
    expect(row.autoSentAt).toBeNull();
    expect(row.autoSendError).toContain("SMTP indisponible");
  });
});

describe("sendDueCoworkingInvoices (envoi groupé)", () => {
  it("refuse quand le réglage global est éteint", async () => {
    await setGlobalAutoSend(false);
    const res = await sendDueCoworkingInvoices({});
    expect(res).toMatchObject({
      ok: false,
      code: "internal",
      message: expect.stringMatching(/désactivé/),
    });
  });

  it("n'envoie que les factures dues des contrats opt-in facturés par Parade", async () => {
    await setGlobalAutoSend(true);
    // Vide la file laissée par les tests précédents : tout ce qui est encore
    // envoyable est marqué comme parti.
    await db.update(invoices).set({ autoSentAt: new Date() }).where(eq(invoices.kind, "coworking"));

    const due = await createContractWithInvoice({});
    const notOptedIn = await createContractWithInvoice({ autoSend: false });
    const gAndO = await createContractWithInvoice({ billedBy: "g_and_o" });
    const emailOnly = await createContractWithInvoice({
      invoice: {
        status: "sent",
        dougsInvoiceId: FINAL_ID,
        dougsReference: "F-2026-0001",
        dougsStatus: "WAITING",
      },
    });
    const alreadySent = await createContractWithInvoice({
      invoice: { status: "sent", autoSentAt: new Date() },
    });

    const res = await sendDueCoworkingInvoices({});
    if (!res.ok) throw new Error(res.message);
    expect(res.data.errors).toEqual([]);
    expect(res.data.blocked).toEqual([]);
    expect(res.data.sent.map((s) => s.contractName).sort()).toEqual(
      [due.contract.name, emailOnly.contract.name].sort(),
    );
    expect(finalizeDougsSalesInvoice).toHaveBeenCalledTimes(1);
    expect(deliverDocumentEmail).toHaveBeenCalledTimes(2);

    for (const { invoiceId } of [notOptedIn, gAndO]) {
      const row = await invoiceById(invoiceId);
      expect(row.status).toBe("draft");
      expect(row.autoSentAt).toBeNull();
    }
    expect((await invoiceById(alreadySent.invoiceId)).dougsInvoiceId).toBeNull();
  });
});
