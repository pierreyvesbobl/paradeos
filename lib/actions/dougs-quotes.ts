"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invoices } from "@/db/schema/invoices";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";

const lineSchema = z.object({
  title: z.string().trim().min(1, "Titre requis."),
  description: z.string().trim().default(""),
  unit: z.string().trim().min(1).default("forfait"),
  quantity: z.number().positive("Quantité > 0."),
  unitAmount: z.number().nonnegative(),
  vatRate: z.number().min(0).max(1).default(0.2),
  discount: z.number().nonnegative().default(0),
  discountUnit: z.enum(["%", "€"]).default("%"),
});

type QuoteLineInput = z.infer<typeof lineSchema>;

function _computeLineAmount(line: QuoteLineInput): number {
  const gross = line.quantity * line.unitAmount;
  if (line.discountUnit === "%") {
    return Math.round(gross * (1 - line.discount / 100) * 100) / 100;
  }
  return Math.round(Math.max(0, gross - line.discount) * 100) / 100;
}

function _computeLineDiscountInEuros(line: QuoteLineInput): number {
  const gross = line.quantity * line.unitAmount;
  if (line.discountUnit === "%") {
    return Math.round(((gross * line.discount) / 100) * 100) / 100;
  }
  return Math.min(gross, line.discount);
}

export const unlinkProjectDougsQuote = action(
  z.object({ projectId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(invoices)
      .set({
        dougsQuoteId: null,
        dougsReference: null,
        dougsStatus: null,
        dougsTotalHt: null,
        dougsTotalVat: null,
        dougsTotalTtc: null,
        dougsIssuedAt: null,
        dougsSyncedAt: null,
        status: "draft",
        invoicedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.projectId, input.projectId), eq(invoices.kind, "quote")));
    revalidatePath(`/projets/${input.projectId}`);
    revalidatePath("/compta");
    return { ok: true };
  },
);
