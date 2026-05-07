"use server";

import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createProjectSchema,
  deleteProjectSchema,
  patchProjectSchema,
  quickCreateProjectSchema,
  updateProjectSchema,
} from "@/lib/schemas/projects";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const createProject = action(createProjectSchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(projects)
    .values({
      name: input.name,
      kind: input.kind,
      status: input.status,
      entityId: input.entityId ?? null,
      contactId: input.contactId ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      ownerId: input.ownerId ?? user.id,
      createdBy: user.id,
      billingType: input.billingType,
      budgetAmount: input.budgetAmount != null ? input.budgetAmount.toString() : null,
      hourlyRate: input.hourlyRate != null ? input.hourlyRate.toString() : null,
      valueAmount: input.valueAmount != null ? input.valueAmount.toString() : null,
      probability: input.probability ?? null,
      source: input.source ?? null,
      firstContactDate: input.firstContactDate ?? null,
      lastContactDate: input.lastContactDate ?? null,
      followUpDate: input.followUpDate ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
    })
    .returning({ id: projects.id });

  revalidatePath("/projets");
  return { id: row?.id };
});

export const updateProject = action(updateProjectSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .update(projects)
    .set({
      name: input.name,
      kind: input.kind,
      status: input.status,
      entityId: input.entityId ?? null,
      contactId: input.contactId ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      ownerId: input.ownerId ?? null,
      billingType: input.billingType,
      budgetAmount: input.budgetAmount != null ? input.budgetAmount.toString() : null,
      hourlyRate: input.hourlyRate != null ? input.hourlyRate.toString() : null,
      valueAmount: input.valueAmount != null ? input.valueAmount.toString() : null,
      probability: input.probability ?? null,
      source: input.source ?? null,
      firstContactDate: input.firstContactDate ?? null,
      lastContactDate: input.lastContactDate ?? null,
      followUpDate: input.followUpDate ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
    })
    .where(eq(projects.id, input.id));

  revalidatePath("/projets");
  revalidatePath(`/projets/${input.id}`);
  return { id: input.id };
});

/**
 * Patch partiel d'un projet depuis l'édition inline. Seuls les champs
 * fournis sont mis à jour. `null` = effacer.
 */
/**
 * Création rapide depuis un picker FK : juste un nom (kind=transverse,
 * status=planning par défaut).
 */
export const quickCreateProject = action(quickCreateProjectSchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(projects)
    .values({
      name: input.name,
      kind: "transverse",
      status: "planning",
      ownerId: user.id,
      createdBy: user.id,
    })
    .returning({ id: projects.id, name: projects.name });
  if (!row) throw new Error("Création échouée.");
  revalidatePath("/projets");
  return { id: row.id, name: row.name };
});

export const patchProject = action(patchProjectSchema, async ({ input }) => {
  const conn = await db();
  const updates: Partial<typeof projects.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.kind !== undefined) updates.kind = input.kind;
  if (input.status !== undefined) updates.status = input.status;
  if (input.entityId !== undefined) updates.entityId = input.entityId;
  if (input.color !== undefined) updates.color = input.color;
  if (input.icon !== undefined) updates.icon = input.icon;
  if (input.description !== undefined) updates.description = input.description;
  if (input.startDate !== undefined) updates.startDate = input.startDate;
  if (input.endDate !== undefined) updates.endDate = input.endDate;
  if (input.ownerId !== undefined) updates.ownerId = input.ownerId;
  if (input.billingType !== undefined) updates.billingType = input.billingType;
  if (input.budgetAmount !== undefined) {
    updates.budgetAmount = input.budgetAmount != null ? input.budgetAmount.toString() : null;
  }
  if (input.hourlyRate !== undefined) {
    updates.hourlyRate = input.hourlyRate != null ? input.hourlyRate.toString() : null;
  }
  if (input.contactId !== undefined) updates.contactId = input.contactId;
  if (input.valueAmount !== undefined) {
    updates.valueAmount = input.valueAmount != null ? input.valueAmount.toString() : null;
  }
  if (input.probability !== undefined) updates.probability = input.probability;
  if (input.source !== undefined) updates.source = input.source;
  if (input.firstContactDate !== undefined) updates.firstContactDate = input.firstContactDate;
  if (input.lastContactDate !== undefined) updates.lastContactDate = input.lastContactDate;
  if (input.followUpDate !== undefined) updates.followUpDate = input.followUpDate;
  if (input.expectedCloseDate !== undefined) updates.expectedCloseDate = input.expectedCloseDate;

  await conn.update(projects).set(updates).where(eq(projects.id, input.id));

  revalidatePath("/projets");
  revalidatePath(`/projets/${input.id}`);
  return { id: input.id };
});

export const deleteProject = action(deleteProjectSchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(projects).where(eq(projects.id, input.id));
  revalidatePath("/projets");
  return { id: input.id };
});

export async function deleteProjectAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteProject({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/projets");
}
