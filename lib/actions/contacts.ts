"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Database } from "@/db/client";
import { contactEmails } from "@/db/schema/contact-emails";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { action } from "@/lib/actions/action";
import { assertContactIsNew, assertEmailFree } from "@/lib/crm/assert-new";
import { findExistingContactId } from "@/lib/crm/find-or-link";
import { normalizeEmail } from "@/lib/crm/name-key";
import { db } from "@/lib/db/server";
import { formatPersonName } from "@/lib/format";
import {
  addContactEmailSchema,
  createContactSchema,
  deleteContactSchema,
  patchContactSchema,
  quickCreateContactSchema,
  removeContactEmailSchema,
  setPrimaryContactEmailSchema,
  updateContactSchema,
} from "@/lib/schemas/contacts";

function revalidateContact(id: string, entityId?: string | null) {
  revalidatePath("/crm/contacts");
  revalidatePath(`/contacts/${id}`);
  if (entityId) revalidatePath(`/entites/${entityId}`);
}

/**
 * Adresses secondaires à écrire pour un contact : normalisées, sans doublon,
 * sans l'adresse principale, et chacune libre chez les autres fiches.
 */
async function prepareOtherEmails(
  raw: string[] | undefined,
  primary: string | null,
  exceptContactId?: string,
): Promise<string[]> {
  const primaryKey = normalizeEmail(primary);
  const list = [...new Set((raw ?? []).map(normalizeEmail).filter(Boolean))].filter(
    (e) => e !== primaryKey,
  );
  for (const email of list) await assertEmailFree(email, { exceptContactId });
  return list;
}

/** Remplace l'ensemble des adresses secondaires d'un contact. */
async function replaceOtherEmails(conn: Database, contactId: string, emails: string[]) {
  await conn.delete(contactEmails).where(eq(contactEmails.contactId, contactId));
  if (emails.length > 0) {
    await conn.insert(contactEmails).values(emails.map((email) => ({ contactId, email })));
  }
}

export const createContact = action(createContactSchema, async ({ input, user }) => {
  const conn = await db();
  await assertContactIsNew({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email ?? null,
  });
  const otherEmails = await prepareOtherEmails(input.otherEmails, input.email ?? null);
  const [row] = await conn
    .insert(contacts)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      jobTitle: input.jobTitle ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      entityId: input.entityId ?? null,
      ownerId: input.ownerId ?? user.id,
      qualification: input.qualification ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      createdBy: user.id,
    })
    .returning({ id: contacts.id });
  if (!row) throw new Error("Création échouée.");
  if (otherEmails.length > 0) {
    await conn
      .insert(contactEmails)
      .values(otherEmails.map((email) => ({ contactId: row.id, email })));
  }

  revalidatePath("/crm/contacts");
  if (input.entityId) revalidatePath(`/entites/${input.entityId}`);
  return { id: row.id };
});

export const updateContact = action(updateContactSchema, async ({ input }) => {
  const conn = await db();
  if (input.email) await assertEmailFree(input.email, { exceptContactId: input.id });
  const otherEmails = await prepareOtherEmails(input.otherEmails, input.email ?? null, input.id);
  await conn
    .update(contacts)
    .set({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      jobTitle: input.jobTitle ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      entityId: input.entityId ?? null,
      ownerId: input.ownerId ?? null,
      qualification: input.qualification ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    })
    .where(eq(contacts.id, input.id));
  // `otherEmails` absent (appelant qui ne connaît pas le champ) → on ne
  // touche pas aux adresses secondaires ; présent → c'est la liste complète.
  if (input.otherEmails !== undefined) await replaceOtherEmails(conn, input.id, otherEmails);

  revalidateContact(input.id, input.entityId);
  return { id: input.id };
});

/**
 * Création rapide depuis un picker FK. `fullName` est splitté sur le
 * premier espace : "Pierre-Yves Sage" → firstName="Pierre-Yves",
 * lastName="Sage". Si pas d'espace, lastName=fullName.
 */
export const quickCreateContact = action(quickCreateContactSchema, async ({ input, user }) => {
  const conn = await db();
  const trimmed = input.fullName.trim();
  const idx = trimmed.indexOf(" ");
  const firstName = idx > 0 ? trimmed.slice(0, idx) : "";
  const lastName = idx > 0 ? trimmed.slice(idx + 1) : trimmed;

  // Find-or-create : le picker attend un id, donc on rend la fiche
  // existante plutôt que de refuser (cf. `quickCreateEntity`).
  const existingId = await findExistingContactId({ firstName, lastName });
  if (existingId) {
    const [existing] = await conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(eq(contacts.id, existingId))
      .limit(1);
    if (existing) {
      return {
        id: existing.id,
        fullName: formatPersonName(existing.firstName, existing.lastName),
      };
    }
  }

  const [row] = await conn
    .insert(contacts)
    .values({
      firstName,
      lastName,
      entityId: input.entityId ?? null,
      ownerId: user.id,
      createdBy: user.id,
    })
    .returning({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    });
  if (!row) throw new Error("Création échouée.");
  revalidatePath("/crm/contacts");
  if (input.entityId) revalidatePath(`/entites/${input.entityId}`);
  return {
    id: row.id,
    fullName: formatPersonName(row.firstName, row.lastName),
  };
});

export const patchContact = action(patchContactSchema, async ({ input }) => {
  const conn = await db();
  const { id, ...rest } = input;
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) return { id };
  if (typeof updates.email === "string") {
    await assertEmailFree(updates.email, { exceptContactId: id });
    // Promue en principale par saisie directe : elle ne reste pas en secondaire.
    await conn
      .delete(contactEmails)
      .where(
        and(
          eq(contactEmails.contactId, id),
          sql`lower(${contactEmails.email}) = ${normalizeEmail(updates.email)}`,
        ),
      );
  }
  await conn.update(contacts).set(updates).where(eq(contacts.id, id));
  revalidateContact(id);
  return { id };
});

/** Ajoute une adresse secondaire à une fiche. */
export const addContactEmail = action(addContactEmailSchema, async ({ input }) => {
  const conn = await db();
  const [contact] = await conn
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, input.contactId))
    .limit(1);
  if (!contact) throw new Error("Contact introuvable.");
  if (normalizeEmail(contact.email) === input.email) {
    throw new Error("C'est déjà l'adresse principale de ce contact.");
  }
  await assertEmailFree(input.email, { exceptContactId: input.contactId });
  const [row] = await conn
    .insert(contactEmails)
    .values({ contactId: input.contactId, email: input.email, label: input.label ?? null })
    .onConflictDoNothing()
    .returning({ id: contactEmails.id });
  if (!row) throw new Error("Cette adresse est déjà sur la fiche.");
  revalidateContact(input.contactId);
  return { id: row.id, email: input.email };
});

/** Retire une adresse secondaire. L'adresse principale se vide via `patchContact`. */
export const removeContactEmail = action(removeContactEmailSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .delete(contactEmails)
    .where(
      and(
        eq(contactEmails.contactId, input.contactId),
        sql`lower(${contactEmails.email}) = ${input.email}`,
      ),
    );
  revalidateContact(input.contactId);
  return { contactId: input.contactId };
});

/**
 * Fait d'une adresse secondaire l'adresse principale. L'ancienne principale
 * redescend en secondaire : on ne perd jamais une adresse par un simple
 * échange.
 */
export const setPrimaryContactEmail = action(setPrimaryContactEmailSchema, async ({ input }) => {
  const conn = await db();
  await conn.transaction(async (tx) => {
    const [contact] = await tx
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new Error("Contact introuvable.");
    const [secondary] = await tx
      .select({ id: contactEmails.id })
      .from(contactEmails)
      .where(
        and(
          eq(contactEmails.contactId, input.contactId),
          sql`lower(${contactEmails.email}) = ${input.email}`,
        ),
      )
      .limit(1);
    if (!secondary) throw new Error("Cette adresse n'est pas sur la fiche.");

    await tx.delete(contactEmails).where(eq(contactEmails.id, secondary.id));
    await tx.update(contacts).set({ email: input.email }).where(eq(contacts.id, input.contactId));
    const previous = normalizeEmail(contact.email);
    if (previous && previous !== input.email) {
      await tx
        .insert(contactEmails)
        .values({ contactId: input.contactId, email: previous })
        .onConflictDoNothing();
    }
  });
  revalidateContact(input.contactId);
  return { contactId: input.contactId, email: input.email };
});

export const deleteContact = action(deleteContactSchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(contacts).where(eq(contacts.id, input.id));
  revalidatePath("/crm/contacts");
  return { id: input.id };
});

/**
 * Lecture compacte pour la modale d'aperçu — pas de notes, pas de pièces
 * jointes. L'objectif est d'éviter d'embarquer le payload complet de la
 * fiche dans chaque chip de la page projet.
 */
export const getContactPreview = action(
  z.object({ id: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    const [row] = await conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        linkedinUrl: contacts.linkedinUrl,
        notes: contacts.notes,
        entityId: entities.id,
        entityName: entities.name,
      })
      .from(contacts)
      .leftJoin(entities, eq(contacts.entityId, entities.id))
      .where(eq(contacts.id, input.id))
      .limit(1);
    if (!row) throw new Error("Contact introuvable.");
    return row;
  },
  { allowViewer: true },
);

export async function deleteContactAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteContact({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/contacts");
}
