"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createEntitySchema,
  deleteEntitySchema,
  patchEntitySchema,
  quickCreateEntitySchema,
  updateEntitySchema,
} from "@/lib/schemas/entities";
import { asc, eq, ilike, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export const createEntity = action(createEntitySchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(entities)
    .values({
      name: input.name,
      kind: input.kind,
      website: input.website ?? null,
      siren: input.siren ?? null,
      vatNumber: input.vatNumber ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      ownerId: input.ownerId ?? user.id,
      createdBy: user.id,
    })
    .returning({ id: entities.id });

  revalidatePath("/crm/entites");
  return { id: row?.id };
});

export const updateEntity = action(updateEntitySchema, async ({ input }) => {
  const conn = await db();
  await conn
    .update(entities)
    .set({
      name: input.name,
      kind: input.kind,
      website: input.website ?? null,
      siren: input.siren ?? null,
      vatNumber: input.vatNumber ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      ownerId: input.ownerId ?? null,
    })
    .where(eq(entities.id, input.id));

  revalidatePath("/crm/entites");
  revalidatePath(`/entites/${input.id}`);
  return { id: input.id };
});

/**
 * Création rapide depuis un picker FK (Notion-like). Crée une entité
 * avec juste un nom (kind=prospect par défaut), retourne id + nom.
 */
export const quickCreateEntity = action(quickCreateEntitySchema, async ({ input, user }) => {
  const conn = await db();
  // Find-or-create : si une entité du même nom existe déjà, on la réutilise.
  // Évite qu'un double-clic / re-render du picker n'insère plusieurs fois
  // la même entité.
  const [existing] = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(ilike(entities.name, input.name))
    .limit(1);
  if (existing) {
    return { id: existing.id, name: existing.name };
  }
  const [row] = await conn
    .insert(entities)
    .values({
      name: input.name,
      kind: "prospect",
      ownerId: user.id,
      createdBy: user.id,
    })
    .returning({ id: entities.id, name: entities.name });
  if (!row) throw new Error("Création échouée.");
  revalidatePath("/crm/entites");
  return { id: row.id, name: row.name };
});

export const patchEntity = action(patchEntitySchema, async ({ input }) => {
  const conn = await db();
  const { id, ...rest } = input;
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) return { id };
  await conn.update(entities).set(updates).where(eq(entities.id, id));
  revalidatePath("/crm/entites");
  revalidatePath(`/entites/${id}`);
  return { id };
});

export const deleteEntity = action(deleteEntitySchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(entities).where(eq(entities.id, input.id));
  revalidatePath("/crm/entites");
  return { id: input.id };
});

/**
 * Lecture compacte pour la modale d'aperçu — informations clé + contacts
 * rattachés (3 max pour rester compact). Charge à la demande à l'ouverture
 * du modal.
 */
export const getEntityPreview = action(z.object({ id: z.string().uuid() }), async ({ input }) => {
  const conn = await db();
  const [entity] = await conn
    .select({
      id: entities.id,
      name: entities.name,
      kind: entities.kind,
      website: entities.website,
      siren: entities.siren,
      vatNumber: entities.vatNumber,
      address: entities.address,
      notes: entities.notes,
    })
    .from(entities)
    .where(eq(entities.id, input.id))
    .limit(1);
  if (!entity) throw new Error("Entité introuvable.");

  const [{ count: contactsCount } = { count: 0 }] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.entityId, input.id));

  const previewContacts = await conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      jobTitle: contacts.jobTitle,
    })
    .from(contacts)
    .where(eq(contacts.entityId, input.id))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(5);

  return { entity, contactsCount, previewContacts };
});

export async function deleteEntityAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteEntity({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/entites");
}
