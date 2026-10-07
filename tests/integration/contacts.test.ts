import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { contactEmails } from "@/db/schema/contact-emails";
import { contacts } from "@/db/schema/contacts";
import {
  addContactEmail,
  createContact,
  patchContact,
  removeContactEmail,
  setPrimaryContactEmail,
  updateContact,
} from "@/lib/actions/contacts";
import { matchContact } from "@/lib/crm/candidates";
import { allEmailsOfContact, allKnownContactEmails } from "@/lib/crm/contact-emails";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { createTestDb, seedUser, type TestUser } from "./db";
import { actAs, useTestDb } from "./setup";

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

async function primaryOf(id: string) {
  const [row] = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, id));
  return row?.email ?? null;
}

async function secondariesOf(id: string) {
  const rows = await db
    .select({ email: contactEmails.email })
    .from(contactEmails)
    .where(eq(contactEmails.contactId, id));
  return rows.map((r) => r.email).sort();
}

describe("adresses e-mail multiples", () => {
  it("crée un contact avec des adresses secondaires, normalisées et dédoublonnées", async () => {
    const res = await createContact({
      firstName: "Julien",
      lastName: "Lacoëntre",
      email: "Julien@Cephalopode.com",
      otherEmails: [
        "  JULIEN.PERSO@gmail.com ",
        "julien.perso@gmail.com",
        "",
        "julien@cephalopode.com",
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const id = res.data.id;
    if (!id) throw new Error("id manquant");

    expect(await primaryOf(id)).toBe("julien@cephalopode.com");
    // La principale n'est pas dupliquée en secondaire, la vide est ignorée.
    expect(await secondariesOf(id)).toEqual(["julien.perso@gmail.com"]);
    expect(await allEmailsOfContact(db, id)).toEqual([
      "julien@cephalopode.com",
      "julien.perso@gmail.com",
    ]);
  });

  it("retrouve un contact par une adresse secondaire (sync Gmail, LinkedIn, réunions)", async () => {
    const found = await findContactByEmail("Julien.Perso@GMAIL.com");
    expect(found?.firstName).toBe("Julien");

    const known = await allKnownContactEmails(db);
    expect(known.has("julien.perso@gmail.com")).toBe(true);
    expect(known.has("julien@cephalopode.com")).toBe(true);

    const match = await matchContact(db, "J.", "L.", { email: "julien.perso@gmail.com" });
    expect(match?.confidence).toBe(1);
  });

  it("refuse une adresse déjà portée par une autre fiche, en principale ou en secondaire", async () => {
    const other = await createContact({ firstName: "Amine", lastName: "Slim" });
    if (!other.ok || !other.data.id) throw new Error("création");
    const amine = other.data.id;

    const byPrimary = await addContactEmail({ contactId: amine, email: "julien@cephalopode.com" });
    expect(byPrimary.ok).toBe(false);
    if (!byPrimary.ok) expect(byPrimary.message).toContain("Julien Lacoëntre");

    const bySecondary = await addContactEmail({
      contactId: amine,
      email: "julien.perso@gmail.com",
    });
    expect(bySecondary.ok).toBe(false);

    // Idem pour la principale posée par édition inline.
    const patched = await patchContact({ id: amine, email: "julien.perso@gmail.com" });
    expect(patched.ok).toBe(false);

    // Et à la création : l'adresse secondaire de Julien vaut une principale.
    const dup = await createContact({
      firstName: "Jules",
      lastName: "Perso",
      email: "julien.perso@gmail.com",
    });
    expect(dup.ok).toBe(false);
  });

  it("ajoute, promeut en principale (échange) puis retire", async () => {
    const julien = await findContactByEmail("julien@cephalopode.com");
    if (!julien) throw new Error("Julien introuvable");

    const added = await addContactEmail({
      contactId: julien.id,
      email: "Julien@Nextase.fr",
      label: "nouvelle boîte",
    });
    expect(added.ok).toBe(true);
    expect(await secondariesOf(julien.id)).toEqual(["julien.perso@gmail.com", "julien@nextase.fr"]);

    const again = await addContactEmail({ contactId: julien.id, email: "julien@nextase.fr" });
    expect(again.ok).toBe(false);
    const asPrimary = await addContactEmail({
      contactId: julien.id,
      email: "julien@cephalopode.com",
    });
    expect(asPrimary.ok).toBe(false);

    const promoted = await setPrimaryContactEmail({
      contactId: julien.id,
      email: "julien@nextase.fr",
    });
    expect(promoted.ok).toBe(true);
    expect(await primaryOf(julien.id)).toBe("julien@nextase.fr");
    // L'ancienne principale n'est pas perdue : elle redescend en secondaire.
    expect(await secondariesOf(julien.id)).toEqual([
      "julien.perso@gmail.com",
      "julien@cephalopode.com",
    ]);

    const removed = await removeContactEmail({
      contactId: julien.id,
      email: "julien@cephalopode.com",
    });
    expect(removed.ok).toBe(true);
    expect(await secondariesOf(julien.id)).toEqual(["julien.perso@gmail.com"]);
  });

  it("saisir en principale une adresse déjà secondaire la retire des secondaires", async () => {
    const julien = await findContactByEmail("julien@nextase.fr");
    if (!julien) throw new Error("Julien introuvable");
    const res = await patchContact({ id: julien.id, email: "julien.perso@gmail.com" });
    expect(res.ok).toBe(true);
    expect(await primaryOf(julien.id)).toBe("julien.perso@gmail.com");
    expect(await secondariesOf(julien.id)).toEqual([]);
  });

  it("le formulaire complet remplace la liste des secondaires, sans y toucher si elle est absente", async () => {
    const julien = await findContactByEmail("julien.perso@gmail.com");
    if (!julien) throw new Error("Julien introuvable");

    const withList = await updateContact({
      id: julien.id,
      firstName: "Julien",
      lastName: "Lacoëntre",
      email: "julien.perso@gmail.com",
      otherEmails: ["a@ex.fr", "b@ex.fr"],
    });
    expect(withList.ok).toBe(true);
    expect(await secondariesOf(julien.id)).toEqual(["a@ex.fr", "b@ex.fr"]);

    const withoutList = await updateContact({
      id: julien.id,
      firstName: "Julien",
      lastName: "Lacoëntre",
      email: "julien.perso@gmail.com",
    });
    expect(withoutList.ok).toBe(true);
    expect(await secondariesOf(julien.id)).toEqual(["a@ex.fr", "b@ex.fr"]);
  });

  it("supprimer le contact emporte ses adresses secondaires", async () => {
    const julien = await findContactByEmail("a@ex.fr");
    if (!julien) throw new Error("Julien introuvable");
    await db.delete(contacts).where(eq(contacts.id, julien.id));
    expect(await secondariesOf(julien.id)).toEqual([]);
    expect(await findContactByEmail("a@ex.fr")).toBeNull();
  });
});
