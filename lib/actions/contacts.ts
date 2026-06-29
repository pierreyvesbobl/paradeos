"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createContactSchema,
  deleteContactSchema,
  patchContactSchema,
  quickCreateContactSchema,
  updateContactSchema,
} from "@/lib/schemas/contacts";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export const createContact = action(createContactSchema, async ({ input, user }) => {
  const conn = await db();
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

  revalidatePath("/crm/contacts");
  if (input.entityId) revalidatePath(`/entites/${input.entityId}`);
  return { id: row?.id };
});

export const updateContact = action(updateContactSchema, async ({ input }) => {
  const conn = await db();
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

  revalidatePath("/crm/contacts");
  revalidatePath(`/contacts/${input.id}`);
  if (input.entityId) revalidatePath(`/entites/${input.entityId}`);
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
    fullName: `${row.firstName} ${row.lastName}`.trim(),
  };
});

export const patchContact = action(patchContactSchema, async ({ input }) => {
  const conn = await db();
  const { id, ...rest } = input;
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) return { id };
  await conn.update(contacts).set(updates).where(eq(contacts.id, id));
  revalidatePath("/crm/contacts");
  revalidatePath(`/contacts/${id}`);
  return { id };
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
export const getContactPreview = action(z.object({ id: z.string().uuid() }), async ({ input }) => {
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
});

export async function deleteContactAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteContact({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/contacts");
}
