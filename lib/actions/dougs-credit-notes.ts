"use server";

import { dougsCreditNoteLinks } from "@/db/schema/dougs";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Rattache une facture d'avoir Dougs à la facture Dougs qu'elle annule.
 * Si un lien existe déjà pour ce credit note, on l'écrase. Une avoir →
 * une seule facture annulée (UPSERT par dougs_credit_note_id).
 */
export const linkDougsCreditNote = action(
  z.object({
    creditNoteId: z.string().min(1),
    originalInvoiceId: z.string().min(1),
  }),
  async ({ input, user }) => {
    if (input.creditNoteId === input.originalInvoiceId) {
      throw new Error("Un avoir ne peut pas s'annuler lui-même.");
    }
    const conn = await db();
    const existing = await conn
      .select({ id: dougsCreditNoteLinks.id })
      .from(dougsCreditNoteLinks)
      .where(eq(dougsCreditNoteLinks.dougsCreditNoteId, input.creditNoteId))
      .limit(1);
    if (existing[0]) {
      await conn
        .update(dougsCreditNoteLinks)
        .set({
          cancelsDougsInvoiceId: input.originalInvoiceId,
          updatedAt: new Date(),
        })
        .where(eq(dougsCreditNoteLinks.id, existing[0].id));
    } else {
      await conn.insert(dougsCreditNoteLinks).values({
        dougsCreditNoteId: input.creditNoteId,
        cancelsDougsInvoiceId: input.originalInvoiceId,
        createdBy: user.id,
      });
    }
    revalidatePath("/compta");
    return { ok: true as const };
  },
);

export const unlinkDougsCreditNote = action(
  z.object({ creditNoteId: z.string().min(1) }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .delete(dougsCreditNoteLinks)
      .where(eq(dougsCreditNoteLinks.dougsCreditNoteId, input.creditNoteId));
    revalidatePath("/compta");
    return { ok: true as const };
  },
);
