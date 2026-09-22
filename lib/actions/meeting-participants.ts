"use server";

import { contacts } from "@/db/schema/contacts";
import { meetingParticipants } from "@/db/schema/meeting-participants";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { formatPersonName } from "@/lib/format";
import {
  addMeetingParticipantSchema,
  removeMeetingParticipantSchema,
} from "@/lib/schemas/meetings";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export const addMeetingParticipant = action(
  addMeetingParticipantSchema,
  async ({ input, user }) => {
    const conn = await db();

    await conn
      .insert(meetingParticipants)
      .values({
        meetingId: input.meetingId,
        userId: input.userId ?? null,
        contactId: input.contactId ?? null,
        displayName: input.displayName ?? null,
        role: input.role ?? null,
        source: "manual",
        addedBy: user.id,
      })
      .onConflictDoNothing();

    // Le participant prend la place du nom brut correspondant s'il en
    // existe un : l'extraction pose « Marc Dupont » sans fiche, l'ajout du
    // vrai contact doit remplacer le mémo, pas le doubler.
    const canonicalName = await resolveName(input.userId, input.contactId);
    if (canonicalName) await dropLooseName(input.meetingId, canonicalName);

    revalidatePath(`/meetings/${input.meetingId}`);
    return { ok: true };
  },
);

export const removeMeetingParticipant = action(
  removeMeetingParticipantSchema,
  async ({ input }) => {
    const conn = await db();
    await conn
      .delete(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.id, input.participantId),
          eq(meetingParticipants.meetingId, input.meetingId),
        ),
      );
    revalidatePath(`/meetings/${input.meetingId}`);
    return { ok: true };
  },
);

async function resolveName(
  userId: string | undefined,
  contactId: string | undefined,
): Promise<string | null> {
  const conn = await db();
  if (userId) {
    const [row] = await conn
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.fullName ?? null;
  }
  if (contactId) {
    const [row] = await conn
      .select({ firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    return row ? formatPersonName(row.firstName, row.lastName, "") || null : null;
  }
  return null;
}

/** Supprime le participant en nom libre homonyme, s'il existe. */
async function dropLooseName(meetingId: string, name: string) {
  const conn = await db();
  await conn
    .delete(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meetingId),
        isNotNull(meetingParticipants.displayName),
        sql`lower(${meetingParticipants.displayName}) = lower(${name})`,
      ),
    );
}
