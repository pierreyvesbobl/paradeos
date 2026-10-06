import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as runGenerateCron } from "@/app/api/cron/generate-coworking-invoices/route";
import type { Database } from "@/db/client";
import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { generateNextInvoiceForContract } from "@/lib/coworking/generate-invoice";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

/** Un mardi d'octobre, pour que « la période est dans le futur » soit univoque. */
const TODAY = () => new Date(2026, 9, 6);

async function createContract(
  values: Partial<typeof coworkingContracts.$inferInsert> & { startDate: string },
) {
  const [row] = await db
    .insert(coworkingContracts)
    .values({
      name: values.name ?? `Contrat ${crypto.randomUUID().slice(0, 6)}`,
      desks: 2,
      unitPriceHt: "250.00",
      billingFrequency: "monthly",
      createdBy: actor.id,
      ...values,
    })
    .returning({ id: coworkingContracts.id, name: coworkingContracts.name });
  if (!row) throw new Error("insert contrat");
  return row;
}

async function invoicesOf(contractId: string) {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.coworkingContractId, contractId), eq(invoices.kind, "coworking")))
    .orderBy(invoices.periodStart);
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

describe("generateNextInvoiceForContract", () => {
  it("mensuel : première facture sur le mois de début, puis le mois suivant", async () => {
    const c = await createContract({ startDate: "2026-03-15" });

    const first = await generateNextInvoiceForContract({ contractId: c.id, today: TODAY() });
    expect(first).toMatchObject({
      ok: true,
      created: true,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      name: "mars 2026",
    });

    const second = await generateNextInvoiceForContract({ contractId: c.id, today: TODAY() });
    expect(second).toMatchObject({
      ok: true,
      created: true,
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      name: "avril 2026",
    });

    const rows = await invoicesOf(c.id);
    expect(rows).toHaveLength(2);
    const [march] = rows;
    expect(march).toMatchObject({
      kind: "coworking",
      brand: "coworking",
      status: "draft",
      amountHt: "500.00", // 2 postes × 250 € × 1 mois
      desks: 2,
      unitPriceHt: "250.00",
      billedBy: "parade",
    });
  });

  it("trimestriel : trois mois par facture, montant ×3, libellé Tn", async () => {
    const c = await createContract({ startDate: "2026-02-10", billingFrequency: "quarterly" });
    const res = await generateNextInvoiceForContract({ contractId: c.id, today: TODAY() });
    expect(res).toMatchObject({
      ok: true,
      created: true,
      periodStart: "2026-02-01",
      periodEnd: "2026-04-30",
      name: "T1 2026",
    });
    const [row] = await invoicesOf(c.id);
    expect(row?.amountHt).toBe("1500.00");
  });

  it("ne génère pas en avance une période future, sauf forçage manuel", async () => {
    const c = await createContract({ startDate: "2026-12-01" });
    const cron = await generateNextInvoiceForContract({ contractId: c.id, today: TODAY() });
    expect(cron).toEqual({ ok: true, created: false, reason: "future" });
    expect(await invoicesOf(c.id)).toHaveLength(0);

    const manual = await generateNextInvoiceForContract({
      contractId: c.id,
      today: TODAY(),
      forceFuture: true,
    });
    expect(manual).toMatchObject({ ok: true, created: true, periodStart: "2026-12-01" });
  });

  it("ignore un contrat terminé ou inconnu", async () => {
    const c = await createContract({ startDate: "2026-01-01", status: "termine" });
    expect(await generateNextInvoiceForContract({ contractId: c.id, today: TODAY() })).toEqual({
      ok: true,
      created: false,
      reason: "contract_terminated",
    });
    expect(
      await generateNextInvoiceForContract({ contractId: crypto.randomUUID(), today: TODAY() }),
    ).toEqual({ ok: true, created: false, reason: "missing_contract" });
  });

  it("une facture d'un contrat encaissé par G&O hérite de billedBy", async () => {
    const c = await createContract({ startDate: "2026-09-01", billedBy: "g_and_o" });
    await generateNextInvoiceForContract({ contractId: c.id, today: TODAY() });
    const [row] = await invoicesOf(c.id);
    expect(row?.billedBy).toBe("g_and_o");
  });
});

describe("cron generate-coworking-invoices", () => {
  const request = (secret?: string) =>
    new Request("http://localhost/api/cron/generate-coworking-invoices", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });

  it("refuse sans secret, ou avec un mauvais secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await runGenerateCron(request())).status).toBe(401);
    expect((await runGenerateCron(request("autre"))).status).toBe(401);
    process.env.CRON_SECRET = undefined;
    expect((await runGenerateCron(request("s3cret"))).status).toBe(401);
  });

  it("génère une période par run pour les contrats en cours, jusqu'à être à jour", async () => {
    process.env.CRON_SECRET = "s3cret";
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 10);
    const startDate = `${twoMonthsAgo.getFullYear()}-${String(twoMonthsAgo.getMonth() + 1).padStart(2, "0")}-10`;
    const live = await createContract({ name: "Cron — en cours", startDate });
    const done = await createContract({ name: "Cron — terminé", startDate, status: "termine" });

    const run = async () => {
      const res = await runGenerateCron(request("s3cret"));
      const body = (await res.json()) as {
        ok: boolean;
        created: Array<{ contractName: string }>;
        skipped: Array<{ contractName: string; reason: string }>;
        errors: unknown[];
      };
      return { status: res.status, body };
    };

    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.errors).toEqual([]);
    expect(first.body.created.map((c) => c.contractName)).toContain(live.name);
    expect(JSON.stringify(first.body)).not.toContain(done.name);

    // Un run par période due : -2 mois, -1 mois, mois courant, puis plus rien.
    await run();
    await run();
    const fourth = await run();
    expect(fourth.body.skipped).toContainEqual({ contractName: live.name, reason: "future" });
    expect(await invoicesOf(live.id)).toHaveLength(3);
    expect(await invoicesOf(done.id)).toHaveLength(0);
  });
});
