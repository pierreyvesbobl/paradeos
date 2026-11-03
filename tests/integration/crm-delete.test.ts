import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { deleteContact, deleteEntity } from "../../mcp-server/tools/crm";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

let db: Database;
let close: () => Promise<void>;
let actor: TestUser;

vi.mock("../../mcp-server/db", () => ({ db: () => db }));

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

async function seed() {
  const [entity] = await db
    .insert(entities)
    .values({ name: "Acme" })
    .returning({ id: entities.id });
  if (!entity) throw new Error("insert entité");
  const [contact] = await db
    .insert(contacts)
    .values({ firstName: "Camille", lastName: "Durand", entityId: entity.id })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("insert contact");
  const [contract] = await db
    .insert(coworkingContracts)
    .values({
      name: "Contrat Camille",
      contactId: contact.id,
      billToEntityId: entity.id,
      startDate: "2026-09-01",
      desks: 1,
      unitPriceHt: "250.00",
      createdBy: actor.id,
    })
    .returning({ id: coworkingContracts.id });
  if (!contract) throw new Error("insert contrat");
  return { entityId: entity.id, contactId: contact.id, contractId: contract.id };
}

describe("delete_contact / delete_entity (MCP)", () => {
  it("sans confirm : décrit l'impact et ne supprime rien", async () => {
    const { entityId, contactId } = await seed();

    const contactPreview = await deleteContact({ id: contactId });
    expect(contactPreview).toMatchObject({ preview: true, contact: "Camille Durand" });
    expect("coworkingContractsLosingContact" in contactPreview).toBe(true);

    const entityPreview = await deleteEntity({ id: entityId });
    expect(entityPreview).toMatchObject({ preview: true, entity: "Acme" });

    expect(await db.select().from(contacts).where(eq(contacts.id, contactId))).toHaveLength(1);
    expect(await db.select().from(entities).where(eq(entities.id, entityId))).toHaveLength(1);
  });

  it("confirm : supprime, les rattachements perdent le lien sans disparaître", async () => {
    const { entityId, contactId, contractId } = await seed();

    expect(await deleteEntity({ id: entityId, confirm: true })).toMatchObject({ deleted: true });
    const [contactAfter] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    expect(contactAfter?.entityId).toBeNull();

    expect(await deleteContact({ id: contactId, confirm: true })).toMatchObject({
      deleted: true,
    });
    const [contract] = await db
      .select()
      .from(coworkingContracts)
      .where(eq(coworkingContracts.id, contractId));
    expect(contract?.contactId).toBeNull();
    expect(contract?.billToEntityId).toBeNull();
  });

  it("id inconnu : erreur, rien de touché", async () => {
    await expect(deleteContact({ id: crypto.randomUUID(), confirm: true })).rejects.toThrow(
      /introuvable/,
    );
  });
});
