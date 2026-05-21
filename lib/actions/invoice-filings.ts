"use server";

import { googleAccounts } from "@/db/schema/google-accounts";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { processInvoiceFiling } from "@/lib/gmail/invoice-filer";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

async function getGmailUserId(): Promise<string | null> {
  const conn = await db();
  const rows = await conn
    .select({ id: users.id, scopes: googleAccounts.scopes })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.role, "admin"));
  for (const r of rows) {
    if (hasRequiredGmailScopes(r.scopes)) return r.id;
  }
  return null;
}

/** Relance le classement d'un filing (utile pour les erreurs / rejects). */
export const retryInvoiceFiling = action(
  z.object({ filingId: z.string().uuid() }),
  async ({ input }) => {
    // Reset le status à pending pour que le processInvoiceFiling
    // reparte au début (sinon il no-ope sur les `filed`).
    const conn = await db();
    await conn
      .update(invoiceFilings)
      .set({ status: "pending", errorMessage: null })
      .where(eq(invoiceFilings.id, input.filingId));
    const r = await processInvoiceFiling(input.filingId);
    revalidatePath("/factures");
    return r;
  },
);

/** Marque un filing comme rejeté (pas une facture, doublon, etc.). */
export const rejectInvoiceFiling = action(
  z.object({ filingId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(invoiceFilings)
      .set({ status: "rejected", errorMessage: "Rejeté manuellement." })
      .where(eq(invoiceFilings.id, input.filingId));
    revalidatePath("/factures");
    return { ok: true as const };
  },
);

export const setInvoiceFilingRootFolder = action(
  z.object({ folderId: z.string().min(1).max(200) }),
  async ({ input, user }) => {
    await setSetting(SETTING_KEYS.INVOICE_FILING_ROOT_FOLDER_ID, input.folderId.trim(), user.id);
    revalidatePath("/settings/integrations");
    return { ok: true as const };
  },
);

export const setInvoiceFilingEnabled = action(
  z.object({ enabled: z.boolean() }),
  async ({ input, user }) => {
    await setSetting(
      SETTING_KEYS.INVOICE_FILING_ENABLED,
      input.enabled ? "true" : "false",
      user.id,
    );
    revalidatePath("/settings/integrations");
    return { ok: true as const, enabled: input.enabled };
  },
);

/**
 * Traite manuellement les filings en attente (utile pour drainer après
 * un kill switch ou un retry massif).
 */
export const processAllPendingFilings = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const conn = await db();
  const pending = await conn
    .select({ id: invoiceFilings.id })
    .from(invoiceFilings)
    .where(eq(invoiceFilings.userId, targetUserId))
    .limit(20);
  const stats = { filed: 0, rejected: 0, error: 0 };
  for (const p of pending) {
    try {
      const r = await processInvoiceFiling(p.id);
      if (r.status === "filed") stats.filed++;
      else if (r.status === "rejected") stats.rejected++;
      else stats.error++;
    } catch {
      stats.error++;
    }
  }
  revalidatePath("/factures");
  return stats;
});
