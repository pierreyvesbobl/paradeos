"use server";

import { contacts } from "@/db/schema/contacts";
import { linkedinConnections } from "@/db/schema/linkedin";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { sanitizeNameInput } from "@/lib/format";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Décisions sur la file de rapprochement des relations LinkedIn.
 *
 * Les décisions sont persistées sur `linkedin_connections`
 * (`match_status` + `decided_by` + `decided_at`) plutôt que recalculées :
 * c'est ce qui les rend corrigeables depuis la vue historique, et ce qui
 * empêche un ré-import de revenir sur un choix humain.
 */

const decideSchema = z.object({
  connectionId: z.string().uuid(),
  /**
   * `link`   : rattacher au contact `contactId`
   * `create` : créer un nouveau contact depuis la relation
   * `ignore` : sortir de la file sans rien créer
   */
  decision: z.enum(["link", "create", "ignore"]),
  contactId: z.string().uuid().nullable().optional(),
});

export const decideLinkedinConnection = action(decideSchema, async ({ input, user }) => {
  const conn = await db();

  const [row] = await conn
    .select()
    .from(linkedinConnections)
    .where(
      and(eq(linkedinConnections.id, input.connectionId), eq(linkedinConnections.userId, user.id)),
    )
    .limit(1);
  if (!row) throw new Error("Relation LinkedIn introuvable.");

  const now = new Date();

  if (input.decision === "ignore") {
    await conn
      .update(linkedinConnections)
      .set({
        matchStatus: "ignored",
        matchedContactId: null,
        decidedBy: user.id,
        decidedAt: now,
      })
      .where(eq(linkedinConnections.id, row.id));
    revalidatePath("/inbox");
    return { status: "ignored" as const, contactId: null };
  }

  if (input.decision === "link") {
    // Le contact retenu est celui que l'utilisateur a choisi, pas la
    // suggestion : `contactId` prime toujours sur `matchedContactId`.
    const contactId = input.contactId ?? row.matchedContactId;
    if (!contactId) throw new Error("Aucun contact sélectionné.");

    const [target] = await conn
      .select({
        id: contacts.id,
        linkedinUrl: contacts.linkedinUrl,
        jobTitle: contacts.jobTitle,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!target) throw new Error("Contact introuvable.");

    // Enrichissement sans écrasement : on ne remplit que les trous.
    const patch: { linkedinUrl?: string; jobTitle?: string } = {};
    if (!target.linkedinUrl && row.profileUrl) patch.linkedinUrl = row.profileUrl;
    if (!target.jobTitle) {
      const title = row.position ?? row.headline;
      if (title) patch.jobTitle = title.slice(0, 200);
    }
    if (Object.keys(patch).length > 0) {
      await conn.update(contacts).set(patch).where(eq(contacts.id, contactId));
    }

    await conn
      .update(linkedinConnections)
      .set({
        matchedContactId: contactId,
        matchStatus: "auto_merged",
        decidedBy: user.id,
        decidedAt: now,
      })
      .where(eq(linkedinConnections.id, row.id));

    revalidatePath("/inbox");
    revalidatePath(`/contacts/${contactId}`);
    return { status: "linked" as const, contactId };
  }

  // decision === "create"
  // `first_name` / `last_name` sont NOT NULL : on met "" plutôt que de
  // refuser une relation dont LinkedIn ne donne qu'un nom partiel.
  const firstName = sanitizeNameInput(row.firstName) ?? "";
  const lastName = sanitizeNameInput(row.lastName) ?? "";
  if (!firstName && !lastName) throw new Error("Relation sans nom exploitable.");

  const [created] = await conn
    .insert(contacts)
    .values({
      firstName,
      lastName,
      email: row.email ?? null,
      jobTitle: (row.position ?? row.headline)?.slice(0, 200) ?? null,
      linkedinUrl: row.profileUrl ?? null,
      createdBy: user.id,
    })
    .returning({ id: contacts.id });
  if (!created) throw new Error("Échec de création du contact.");

  await conn
    .update(linkedinConnections)
    .set({
      matchedContactId: created.id,
      matchStatus: "created",
      decidedBy: user.id,
      decidedAt: now,
    })
    .where(eq(linkedinConnections.id, row.id));

  revalidatePath("/inbox");
  revalidatePath("/crm/contacts");
  return { status: "created" as const, contactId: created.id };
});

/**
 * Remet une relation dans la file « à traiter ». Le contact créé ou
 * enrichi n'est pas défait : on annule la décision de rapprochement,
 * pas ses effets sur le CRM — même sémantique que le revert des
 * propositions email.
 */
export const revertLinkedinConnection = action(
  z.object({ connectionId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    await conn
      .update(linkedinConnections)
      .set({ matchStatus: "pending", decidedBy: null, decidedAt: null })
      .where(
        and(
          eq(linkedinConnections.id, input.connectionId),
          eq(linkedinConnections.userId, user.id),
        ),
      );
    revalidatePath("/inbox");
    return { ok: true };
  },
);
