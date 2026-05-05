"use server";

import { entities } from "@/db/schema/entities";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createEntitySchema,
  deleteEntitySchema,
  patchEntitySchema,
  updateEntitySchema,
} from "@/lib/schemas/entities";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

  revalidatePath("/entites");
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

  revalidatePath("/entites");
  revalidatePath(`/entites/${input.id}`);
  return { id: input.id };
});

export const patchEntity = action(patchEntitySchema, async ({ input }) => {
  const conn = await db();
  const { id, ...rest } = input;
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) return { id };
  await conn.update(entities).set(updates).where(eq(entities.id, id));
  revalidatePath("/entites");
  revalidatePath(`/entites/${id}`);
  return { id };
});

export const deleteEntity = action(deleteEntitySchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(entities).where(eq(entities.id, input.id));
  revalidatePath("/entites");
  return { id: input.id };
});

export async function deleteEntityAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteEntity({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/entites");
}
