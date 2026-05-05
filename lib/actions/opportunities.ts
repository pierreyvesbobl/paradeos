"use server";

import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  convertOpportunitySchema,
  createOpportunitySchema,
  deleteOpportunitySchema,
  opportunityStatusEnum,
  patchOpportunitySchema,
  updateOpportunitySchema,
} from "@/lib/schemas/opportunities";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export const createOpportunity = action(createOpportunitySchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(opportunities)
    .values({
      title: input.title,
      status: input.status,
      entityId: input.entityId ?? null,
      contactId: input.contactId ?? null,
      valueAmount: input.valueAmount != null ? input.valueAmount.toString() : null,
      probability: input.probability ?? null,
      source: input.source ?? null,
      firstContactDate: input.firstContactDate ?? null,
      lastContactDate: input.lastContactDate ?? null,
      followUpDate: input.followUpDate ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerId: input.ownerId ?? user.id,
      notes: input.notes ?? null,
      createdBy: user.id,
    })
    .returning({ id: opportunities.id });

  revalidatePath("/opportunites");
  return { id: row?.id };
});

export const updateOpportunity = action(updateOpportunitySchema, async ({ input }) => {
  const conn = await db();
  await conn
    .update(opportunities)
    .set({
      title: input.title,
      status: input.status,
      entityId: input.entityId ?? null,
      contactId: input.contactId ?? null,
      valueAmount: input.valueAmount != null ? input.valueAmount.toString() : null,
      probability: input.probability ?? null,
      source: input.source ?? null,
      firstContactDate: input.firstContactDate ?? null,
      lastContactDate: input.lastContactDate ?? null,
      followUpDate: input.followUpDate ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerId: input.ownerId ?? null,
      notes: input.notes ?? null,
    })
    .where(eq(opportunities.id, input.id));

  revalidatePath("/opportunites");
  revalidatePath(`/opportunites/${input.id}`);
  return { id: input.id };
});

/** Action légère : juste changer le statut (utilisée par le kanban). */
export const moveOpportunityStatus = action(
  z.object({ id: z.string().uuid(), status: opportunityStatusEnum }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(opportunities)
      .set({ status: input.status })
      .where(eq(opportunities.id, input.id));
    revalidatePath("/opportunites");
    revalidatePath("/opportunites/kanban");
    return { id: input.id, status: input.status };
  },
);

/**
 * Patch partiel d'une opportunité depuis l'édition inline. Seuls les champs
 * fournis sont touchés. `null` = effacer.
 */
export const patchOpportunity = action(patchOpportunitySchema, async ({ input }) => {
  const conn = await db();
  const updates: Partial<typeof opportunities.$inferInsert> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.status !== undefined) updates.status = input.status;
  if (input.entityId !== undefined) updates.entityId = input.entityId;
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
  if (input.ownerId !== undefined) updates.ownerId = input.ownerId;
  if (input.notes !== undefined) updates.notes = input.notes;

  await conn.update(opportunities).set(updates).where(eq(opportunities.id, input.id));

  revalidatePath("/opportunites");
  revalidatePath("/opportunites/kanban");
  revalidatePath(`/opportunites/${input.id}`);
  return { id: input.id };
});

export const deleteOpportunity = action(deleteOpportunitySchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(opportunities).where(eq(opportunities.id, input.id));
  revalidatePath("/opportunites");
  return { id: input.id };
});

export async function deleteOpportunityAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteOpportunity({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/opportunites");
}

/**
 * Crée un projet client à partir d'une opportunité gagnée. Lie le projet
 * à l'opportunité (`opportunities.projectId`). Idempotent : si déjà lié,
 * on retourne l'existant.
 */
export const convertOpportunityToProject = action(
  convertOpportunitySchema,
  async ({ input, user }) => {
    const conn = await db();

    const [opp] = await conn
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.id))
      .limit(1);

    if (!opp) throw new Error("Opportunité introuvable.");
    if (opp.status !== "won") {
      throw new Error("L'opportunité doit être au statut Signée pour être convertie.");
    }
    if (!opp.entityId) {
      throw new Error("L'opportunité doit être liée à une entité pour créer un projet client.");
    }
    if (opp.projectId) {
      return { projectId: opp.projectId, alreadyLinked: true as const };
    }

    const [entity] = await conn
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, opp.entityId))
      .limit(1);

    const projectName = input.projectName?.trim() || `${entity?.name ?? "Projet"} — ${opp.title}`;

    const [createdProject] = await conn
      .insert(projects)
      .values({
        name: projectName,
        kind: "client",
        status: "planning",
        entityId: opp.entityId,
        ownerId: opp.ownerId ?? user.id,
        createdBy: user.id,
        startDate: opp.expectedCloseDate ?? null,
        budgetAmount: opp.valueAmount,
      })
      .returning({ id: projects.id });

    if (!createdProject) throw new Error("Échec de création du projet.");

    await conn
      .update(opportunities)
      .set({ projectId: createdProject.id })
      .where(eq(opportunities.id, opp.id));

    revalidatePath("/opportunites");
    revalidatePath(`/opportunites/${opp.id}`);
    revalidatePath("/projets");

    return { projectId: createdProject.id, alreadyLinked: false as const };
  },
);
