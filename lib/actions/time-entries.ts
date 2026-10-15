"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { timeEntries } from "@/db/schema/time-entries";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  createTimeEntrySchema,
  deleteTimeEntrySchema,
  moveTimeEntrySchema,
  updateTimeEntrySchema,
} from "@/lib/schemas/time-entries";
import { attachClaudeSegments, claimableClaudeSegments } from "@/lib/time/claude-blocks";

export const createTimeEntry = action(createTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();

  // Imputation d'un bloc Claude Code : on ne prend que les segments de
  // l'utilisateur encore libres. Un bloc déjà tranché (autre onglet, double
  // clic) ne doit pas produire un second créneau.
  const segmentIds = input.claudeSegmentIds ?? [];
  const segments = await claimableClaudeSegments(conn, user.id, segmentIds);
  if (segmentIds.length > 0 && segments.length === 0) {
    throw new Error("Ce bloc d'activité a déjà été imputé.");
  }

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
      source: segments.length > 0 ? "claude_code" : "manual",
      sourceRef: segments[0]?.sourceRef ?? null,
    })
    .returning({ id: timeEntries.id });

  if (row) {
    await attachClaudeSegments(
      conn,
      segments.map((s) => s.id),
      row.id,
    );
  }

  revalidatePath("/temps");
  revalidatePath("/");
  if (input.projectId) revalidatePath(`/projets/${input.projectId}`);
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

  revalidatePath("/temps");
  revalidatePath("/");
  if (input.projectId) revalidatePath(`/projets/${input.projectId}`);
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
  revalidatePath("/temps");
  revalidatePath("/");
  return { id: input.id };
});

export const deleteTimeEntry = action(deleteTimeEntrySchema, async ({ input, user }) => {
  const conn = await db();
  await conn
    .delete(timeEntries)
    .where(and(eq(timeEntries.id, input.id), eq(timeEntries.userId, user.id)));
  revalidatePath("/temps");
  revalidatePath("/");
  return { id: input.id };
});
