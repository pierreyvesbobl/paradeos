"use server";

import { timeEntries } from "@/db/schema/time-entries";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createTimeEntrySchema,
  deleteTimeEntrySchema,
  moveTimeEntrySchema,
  updateTimeEntrySchema,
} from "@/lib/schemas/time-entries";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export const createTimeEntry = action(createTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();
  const [row] = await conn
    .insert(timeEntries)
    .values({
      userId: user.id,
      kind: input.kind,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      title: input.title ?? null,
      description: input.description ?? null,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      contactId: input.contactId ?? null,
      color: input.color ?? null,
    })
    .returning({ id: timeEntries.id });

  revalidatePath("/planning");
  return { id: row?.id };
});

export const updateTimeEntry = action(updateTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .update(timeEntries)
    .set({
      kind: input.kind,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      title: input.title ?? null,
      description: input.description ?? null,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      contactId: input.contactId ?? null,
      color: input.color ?? null,
    })
    .where(and(eq(timeEntries.id, input.id), eq(timeEntries.userId, user.id)));

  revalidatePath("/planning");
  return { id: input.id };
});

/** Action légère : déplace ou redimensionne un créneau. */
export const moveTimeEntry = action(moveTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .update(timeEntries)
    .set({
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
    })
    .where(and(eq(timeEntries.id, input.id), eq(timeEntries.userId, user.id)));
  revalidatePath("/planning");
  return { id: input.id };
});

export const deleteTimeEntry = action(deleteTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .delete(timeEntries)
    .where(and(eq(timeEntries.id, input.id), eq(timeEntries.userId, user.id)));
  revalidatePath("/planning");
  return { id: input.id };
});
