"use server";

import { projectContacts } from "@/db/schema/project-contacts";
import { projectMembers } from "@/db/schema/project-members";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  addProjectContactSchema,
  addProjectMemberSchema,
  removeProjectContactSchema,
  removeProjectMemberSchema,
} from "@/lib/schemas/project-members";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export const addProjectMember = action(addProjectMemberSchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .insert(projectMembers)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      addedBy: user.id,
    })
    .onConflictDoNothing();
  revalidatePath(`/projets/${input.projectId}`);
  return { ok: true };
});

export const removeProjectMember = action(removeProjectMemberSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .delete(projectMembers)
    .where(
      and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)),
    );
  revalidatePath(`/projets/${input.projectId}`);
  return { ok: true };
});

export const addProjectContact = action(addProjectContactSchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .insert(projectContacts)
    .values({
      projectId: input.projectId,
      contactId: input.contactId,
      addedBy: user.id,
    })
    .onConflictDoNothing();
  revalidatePath(`/projets/${input.projectId}`);
  return { ok: true };
});

export const removeProjectContact = action(removeProjectContactSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .delete(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.contactId, input.contactId),
      ),
    );
  revalidatePath(`/projets/${input.projectId}`);
  return { ok: true };
});
