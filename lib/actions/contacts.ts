"use server";

import { contacts } from "@/db/schema/contacts";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createContactSchema,
  deleteContactSchema,
  patchContactSchema,
  updateContactSchema,
} from "@/lib/schemas/contacts";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
      notes: input.notes ?? null,
      createdBy: user.id,
    })
    .returning({ id: contacts.id });

  revalidatePath("/contacts");
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
      notes: input.notes ?? null,
    })
    .where(eq(contacts.id, input.id));

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${input.id}`);
  if (input.entityId) revalidatePath(`/entites/${input.entityId}`);
  return { id: input.id };
});

export const patchContact = action(patchContactSchema, async ({ input }) => {
  const conn = await db();
  const { id, ...rest } = input;
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) return { id };
  await conn.update(contacts).set(updates).where(eq(contacts.id, id));
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  return { id };
});

export const deleteContact = action(deleteContactSchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(contacts).where(eq(contacts.id, input.id));
  revalidatePath("/contacts");
  return { id: input.id };
});

export async function deleteContactAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteContact({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/contacts");
}
