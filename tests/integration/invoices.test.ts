import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { seedProjectMilestones, setInvoiceStatus, upsertInvoice } from "@/lib/actions/invoices";
import { resolveBillingTerms } from "@/lib/billing/billing-terms";
import { addDaysISO } from "@/lib/billing/invoice-lifecycle";
import { splitMilestoneAmounts } from "@/lib/billing/milestones-math";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

let db: Database;
let close: () => Promise<void>;
let owner: TestUser;
let actor: TestUser;
let viewer: TestUser;

async function createProject(
  args: { ownerId?: string | null; billingTerms?: Record<string, unknown> } = {},
) {
  const [row] = await db
    .insert(projects)
    .values({
      name: "Refonte site",
      kind: "client",
      ownerId: args.ownerId === undefined ? owner.id : args.ownerId,
      billingTerms: args.billingTerms ?? null,
      createdBy: actor.id,
    })
    .returning({ id: projects.id });
  if (!row) throw new Error("insert projet");
  return row.id;
}

async function invoiceById(id: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!row) throw new Error(`facture ${id} introuvable`);
  return row;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  useTestDb(db);
  owner = await seedUser(db, { fullName: "Lead Projet" });
  actor = await seedUser(db, { role: "admin" });
  viewer = await seedUser(db, { role: "viewer" });
  actAs(actor);
});

afterAll(async () => {
  useTestDb(null);
  await close();
});

describe("action() — garde-fous", () => {
  it("refuse un appel anonyme", async () => {
    actAs(null);
    const result = await seedProjectMilestones({ projectId: crypto.randomUUID(), totalHt: 100 });
    actAs(actor);
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("refuse un viewer sur une mutation", async () => {
    actAs(viewer);
    const result = await seedProjectMilestones({ projectId: crypto.randomUUID(), totalHt: 100 });
    actAs(actor);
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
    expect(result.ok ? "" : result.message).toMatch(/lecture seule/);
  });

  it("renvoie les erreurs de champ sur un payload invalide", async () => {
    const result = await seedProjectMilestones({ projectId: "pas-un-uuid", totalHt: -1 });
    expect(result).toMatchObject({ ok: false, code: "validation" });
    if (result.ok) throw new Error("attendu : échec");
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(["projectId", "totalHt"]),
    );
  });
});

describe("seedProjectMilestones", () => {
  it("crée l'acompte et le solde 40/60, assignés au lead du projet", async () => {
    const projectId = await createProject();

    const result = await seedProjectMilestones({ projectId, totalHt: 10_000 });
    expect(result).toEqual({ ok: true, data: { ok: true, created: 2 } });

    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.projectId, projectId))
      .orderBy(invoices.milestonePercent);
    const expected = splitMilestoneAmounts(10_000, 40);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.milestoneType, r.milestonePercent, r.amountHt, r.label])).toEqual([
      ["acompte", 40, expected.acompte.amountHt.toFixed(2), expected.acompte.label],
      ["solde", 60, expected.solde.amountHt.toFixed(2), expected.solde.label],
    ]);
    for (const r of rows) {
      expect(r.kind).toBe("milestone");
      expect(r.brand).toBe("automato");
      expect(r.status).toBe("draft");
      expect(r.assignedTo).toBe(owner.id);
      expect(r.createdBy).toBe(actor.id);
    }
  });

  it("respecte un autre pourcentage d'acompte", async () => {
    const projectId = await createProject();
    await seedProjectMilestones({ projectId, totalHt: 1_000, acomptePercent: 30 });
    const rows = await db.select().from(invoices).where(eq(invoices.projectId, projectId));
    expect(rows.map((r) => r.amountHt).sort()).toEqual(["300.00", "700.00"]);
  });

  it("est idempotent : ne recrée rien si des jalons existent", async () => {
    const projectId = await createProject();
    await seedProjectMilestones({ projectId, totalHt: 5_000 });
    const again = await seedProjectMilestones({ projectId, totalHt: 999 });
    expect(again).toEqual({ ok: true, data: { ok: true, created: 0 } });
    const rows = await db.select().from(invoices).where(eq(invoices.projectId, projectId));
    expect(rows).toHaveLength(2);
  });
});

describe("setInvoiceStatus", () => {
  async function createDraft(projectId: string, extra: { assignedTo?: string | null } = {}) {
    const [row] = await db
      .insert(invoices)
      .values({
        kind: "milestone",
        brand: "automato",
        projectId,
        label: "Acompte 40 %",
        amountHt: "4000.00",
        status: "draft",
        assignedTo: extra.assignedTo ?? null,
        createdBy: actor.id,
      })
      .returning({ id: invoices.id });
    if (!row) throw new Error("insert facture");
    return row.id;
  }

  it("draft → sent : date d'émission, échéance au délai de la marque, lead projet assigné", async () => {
    const projectId = await createProject();
    const id = await createDraft(projectId);
    const before = new Date();

    const result = await setInvoiceStatus({ id, status: "sent" });
    expect(result.ok).toBe(true);

    const row = await invoiceById(id);
    expect(row.status).toBe("sent");
    expect(row.invoicedAt).not.toBeNull();
    expect(row.invoicedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(row.paidAt).toBeNull();
    const dueDays = resolveBillingTerms("automato", null).dueDays;
    expect(row.dueDate).toBe(addDaysISO(row.invoicedAt as Date, dueDays));
    expect(row.assignedTo).toBe(owner.id);
  });

  it("sent : applique le délai négocié sur le projet plutôt que celui de la marque", async () => {
    const projectId = await createProject({ billingTerms: { dueDateOption: "DAYS_60" } });
    const id = await createDraft(projectId);
    await setInvoiceStatus({ id, status: "sent" });
    const row = await invoiceById(id);
    expect(row.dueDate).toBe(addDaysISO(row.invoicedAt as Date, 60));
  });

  it("sent : ne remplace pas un responsable déjà posé", async () => {
    const projectId = await createProject();
    const id = await createDraft(projectId, { assignedTo: actor.id });
    await setInvoiceStatus({ id, status: "sent" });
    expect((await invoiceById(id)).assignedTo).toBe(actor.id);
  });

  it("sent → paid : pose la date de paiement sans toucher à l'émission", async () => {
    const projectId = await createProject();
    const id = await createDraft(projectId);
    await setInvoiceStatus({ id, status: "sent" });
    const sent = await invoiceById(id);

    await setInvoiceStatus({ id, status: "paid" });
    const paid = await invoiceById(id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.invoicedAt?.getTime()).toBe(sent.invoicedAt?.getTime());
    expect(paid.dueDate).toBe(sent.dueDate);
  });

  it("retour en draft : efface émission et paiement", async () => {
    const projectId = await createProject();
    const id = await createDraft(projectId);
    await setInvoiceStatus({ id, status: "paid" });
    await setInvoiceStatus({ id, status: "draft" });
    const row = await invoiceById(id);
    expect(row.invoicedAt).toBeNull();
    expect(row.paidAt).toBeNull();
  });

  it("échoue proprement sur une facture inconnue", async () => {
    const result = await setInvoiceStatus({ id: crypto.randomUUID(), status: "sent" });
    expect(result).toMatchObject({ ok: false, code: "internal", message: "Facture introuvable." });
  });
});

describe("upsertInvoice", () => {
  it("crée une facture libre en brouillon, puis la met à jour par id", async () => {
    const created = await upsertInvoice({
      kind: "one_off",
      label: "Prestation ponctuelle",
      amountHt: 1_200,
    });
    if (!created.ok) throw new Error(created.message);
    const id = (created.data as { id: string }).id;
    const row = await invoiceById(id);
    expect(row.status).toBe("draft");
    expect(row.amountHt).toBe("1200.00");
    expect(row.createdBy).toBe(actor.id);

    const updated = await upsertInvoice({
      id,
      kind: "one_off",
      label: "Prestation ponctuelle — révisée",
      amountHt: 1_500,
    });
    expect(updated.ok).toBe(true);
    const after = await invoiceById(id);
    expect(after.label).toBe("Prestation ponctuelle — révisée");
    expect(after.amountHt).toBe("1500.00");
  });
});
