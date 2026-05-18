"use server";

import { coworkingInvoices } from "@/db/schema/coworking";
import { dougsCreditNoteLinks } from "@/db/schema/dougs";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Détache une facture Dougs de tout jalon projet ou facture coworking
 * qui y pointait. Utilisé en cascade quand un avoir vient annuler cette
 * facture : le lien Paradeos perd son sens et doit disparaître pour
 * éviter de compter le montant dans le dashboard "facturé".
 *
 * Le statut local est remis à "todo" / "a_facturer" (la facture étant
 * annulée, elle n'est plus "émise").
 */
async function detachInvoiceFromParadeos(invoiceId: string): Promise<{
  milestonesCleared: number;
  coworkingCleared: number;
}> {
  const conn = await db();

  // 1. Jalons : on doit fouiller le JSONB billingMilestones de chaque
  // projet. Pas d'index ciblé → scan complet (la table reste petite).
  const allProjects = await conn
    .select({
      id: projects.id,
      billingMilestones: projects.billingMilestones,
    })
    .from(projects);

  let milestonesCleared = 0;
  for (const p of allProjects) {
    const ms = (p.billingMilestones ?? []) as BillingMilestone[];
    let touched = false;
    const next = ms.map((m) => {
      if (m.dougsInvoiceId !== invoiceId) return m;
      touched = true;
      milestonesCleared++;
      return {
        ...m,
        dougsInvoiceId: null,
        dougsInvoiceReference: null,
        dougsStatus: null,
        dougsTotalHt: null,
        dougsTotalVat: null,
        dougsTotalTtc: null,
        dougsIssuedAt: null,
        dougsSyncedAt: null,
        // Le jalon n'est plus "facturé" puisque la facture est annulée.
        // On le ramène à todo et on efface les timestamps qui n'ont
        // plus de sens. L'utilisateur peut le remettre manuellement.
        status: "todo" as const,
        invoicedAt: null,
        paidAt: null,
      };
    });
    if (touched) {
      await conn
        .update(projects)
        .set({ billingMilestones: next, updatedAt: new Date() })
        .where(eq(projects.id, p.id));
      revalidatePath(`/projets/${p.id}`);
    }
  }

  // 2. Factures coworking.
  const cwRows = await conn
    .update(coworkingInvoices)
    .set({
      dougsInvoiceId: null,
      dougsInvoiceReference: null,
      dougsInvoiceStatus: null,
      dougsInvoiceTotalHt: null,
      dougsInvoiceTotalVat: null,
      dougsInvoiceTotalTtc: null,
      dougsInvoiceIssuedAt: null,
      dougsInvoicePaidAt: null,
      dougsInvoiceSyncedAt: null,
      status: "a_facturer",
      updatedAt: new Date(),
    })
    .where(eq(coworkingInvoices.dougsInvoiceId, invoiceId))
    .returning({ id: coworkingInvoices.id });

  for (const c of cwRows) {
    revalidatePath(`/coworking/factures/${c.id}`);
  }

  return { milestonesCleared, coworkingCleared: cwRows.length };
}

/**
 * Rattache une facture d'avoir Dougs à la facture Dougs qu'elle annule.
 * Si un lien existe déjà pour ce credit note, on l'écrase. Une avoir →
 * une seule facture annulée (UPSERT par dougs_credit_note_id).
 *
 * Side-effect : la facture annulée perd son lien Paradeos (jalon /
 * coworking) puisqu'elle n'est plus émise. Cf. detachInvoiceFromParadeos.
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

    const detached = await detachInvoiceFromParadeos(input.originalInvoiceId);
    revalidatePath("/compta");
    revalidatePath("/coworking");
    return { ok: true as const, ...detached };
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
