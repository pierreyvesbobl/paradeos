import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { deliverDocumentEmail } from "@/lib/billing/deliver-document";
import { sendInvoiceCore } from "@/lib/billing/send-document";
import { finalizeDougsSalesInvoice } from "@/lib/dougs/client";
import { sendEmail } from "@/lib/email/client";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

/**
 * Envoi manuel d'une facture coworking (outil MCP `send_document_to_client`
 * et UI) : Dougs et la messagerie sont simulés, la base, la porte d'aperçu et
 * les gardes sont réelles.
 */
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const FINAL_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/billing/deliver-document", () => ({
  deliverDocumentEmail: vi.fn(async () => ({ via: "parade" as const })),
}));

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn(async () => ({ delivered: true })),
}));

vi.mock("@/lib/email/users", () => ({
  getUserEmails: vi.fn(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, "moi@parade.test"])),
  ),
}));

vi.mock("@/lib/dougs/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dougs/client")>();
  return {
    ...original,
    downloadDougsSalesInvoiceDraftPdf: vi.fn(async () => ({ buffer: Buffer.from("%PDF") })),
    canFinalizeDougsSalesInvoice: vi.fn(async () => []),
    finalizeDougsSalesInvoice: vi.fn(async () => ({
      id: DRAFT_ID,
      salesInvoiceId: FINAL_ID,
      reference: "F-2026-0042",
    })),
  };
});

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

const message = { subject: "Facture novembre", body: "Bonjour,\n\nCi-joint la facture." };

async function createCoworkingInvoice(opts: { billedBy?: "parade" | "g_and_o" } = {}) {
  const [contact] = await db
    .insert(contacts)
    .values({ firstName: "Camille", lastName: "Durand", email: "camille@example.test" })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("insert contact");
  const [contract] = await db
    .insert(coworkingContracts)
    .values({
      name: "Contrat Camille",
      contactId: contact.id,
      startDate: "2026-09-01",
      desks: 1,
      unitPriceHt: "250.00",
      billingFrequency: "monthly",
      billedBy: opts.billedBy ?? "parade",
      createdBy: actor.id,
    })
    .returning({ id: coworkingContracts.id });
  if (!contract) throw new Error("insert contrat");
  const [invoice] = await db
    .insert(invoices)
    .values({
      kind: "coworking",
      brand: "coworking",
      coworkingContractId: contract.id,
      label: "novembre 2026",
      amountHt: "250.00",
      vatRate: "0.2",
      status: "draft",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      desks: 1,
      unitPriceHt: "250.00",
      billedBy: opts.billedBy ?? "parade",
      dougsInvoiceId: DRAFT_ID,
      dougsStatus: "DRAFT",
      createdBy: actor.id,
    })
    .returning({ id: invoices.id });
  if (!invoice) throw new Error("insert facture");
  return invoice.id;
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
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

describe("sendInvoiceCore — facture coworking", () => {
  it("aperçu à l'utilisateur, puis finalisation et envoi au contact du contrat", async () => {
    const invoiceId = await createCoworkingInvoice();

    const preview = await sendInvoiceCore({ userId: actor.id, invoiceId, send: false, ...message });
    expect(preview).toEqual({ previewed: true, to: "moi@parade.test", cc: [] });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();

    const sent = await sendInvoiceCore({ userId: actor.id, invoiceId, send: true, ...message });
    expect(sent).toEqual({
      sent: true,
      reference: "F-2026-0042",
      to: "camille@example.test",
      cc: [],
    });
    expect(deliverDocumentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: FINAL_ID,
        recipient: "camille@example.test",
        clientName: "Camille Durand",
        brand: "coworking",
      }),
    );

    const row = await invoiceById(invoiceId);
    expect(row.status).toBe("sent");
    expect(row.dougsInvoiceId).toBe(FINAL_ID);
    expect(row.dueDate).not.toBeNull();
    // Posé ici, il empêche l'envoi automatique de la renvoyer.
    expect(row.autoSentAt).not.toBeNull();
  });

  it("sans aperçu préalable, l'envoi est refusé", async () => {
    const invoiceId = await createCoworkingInvoice();
    await expect(
      sendInvoiceCore({ userId: actor.id, invoiceId, send: true, ...message }),
    ).rejects.toThrow();
    expect(finalizeDougsSalesInvoice).not.toHaveBeenCalled();
  });

  it("facture encaissée par G&O : refusée, même en aperçu", async () => {
    const invoiceId = await createCoworkingInvoice({ billedBy: "g_and_o" });
    await expect(
      sendInvoiceCore({ userId: actor.id, invoiceId, send: false, ...message }),
    ).rejects.toThrow(/G&O/);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
