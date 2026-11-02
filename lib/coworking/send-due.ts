import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { autoSendCoworkingInvoice, isCoworkingAutoSendEnabled } from "@/lib/coworking/auto-send";
import { db } from "@/lib/db/server";
import { DougsAuthError } from "@/lib/dougs/client";

export type SendDueResult = {
  sent: Array<{ contractName: string; label: string; reference: string }>;
  blocked: Array<{ contractName: string; label: string; reason: string }>;
  errors: Array<{ contractName: string; label: string; message: string }>;
};

/**
 * Envoie en une fois les factures coworking dues : bouton de la page
 * Coworking et outil MCP `send_due_coworking_invoices`.
 *
 * Remplace la passe d'envoi du cron : l'API Dougs s'authentifie par un cookie
 * de session rafraîchi par l'extension Chrome, donc un envoi déclenché à 6 h du
 * matin sans personne devant la machine est un pari. Déclenché à la main, le
 * cookie est frais par construction.
 *
 * Les garde-fous restent ceux de l'envoi unitaire — réglage global, opt-in par
 * contrat, G&O exclu, destinataire requis — appliqués facture par facture.
 * `invoiceIds` restreint l'envoi à une liste relue au préalable : ce qui est
 * devenu dû entre la relecture et l'envoi attend le tour suivant.
 */
export async function sendDueCoworkingInvoicesCore(args: {
  userId: string;
  invoiceIds?: string[];
}): Promise<SendDueResult> {
  const enabled = await isCoworkingAutoSendEnabled();
  if (!enabled) throw new Error("L'envoi groupé est désactivé dans les réglages.");

  const conn = await db();
  const queue = await conn
    .select({ id: invoices.id, label: invoices.label, contractName: coworkingContracts.name })
    .from(invoices)
    .innerJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .where(
      and(
        eq(invoices.kind, "coworking"),
        isNull(invoices.autoSentAt),
        eq(coworkingContracts.autoSend, true),
        ne(coworkingContracts.billedBy, "g_and_o"),
        or(
          eq(invoices.status, "draft"),
          // Déjà émise mais le mail n'est pas parti : il reste l'envoi.
          and(eq(invoices.status, "sent"), isNotNull(invoices.dougsInvoiceId)),
        ),
        args.invoiceIds ? inArray(invoices.id, args.invoiceIds) : undefined,
      ),
    )
    .orderBy(asc(invoices.periodStart));

  const result: SendDueResult = { sent: [], blocked: [], errors: [] };

  for (const item of queue) {
    try {
      const res = await autoSendCoworkingInvoice({
        userId: args.userId,
        invoiceId: item.id,
        enabled: true,
      });
      if (!res.ok) {
        result.errors.push({
          contractName: item.contractName,
          label: item.label,
          message: res.message,
        });
      } else if (res.sent) {
        result.sent.push({
          contractName: item.contractName,
          label: item.label,
          reference: res.reference,
        });
      } else {
        result.blocked.push({
          contractName: item.contractName,
          label: item.label,
          reason:
            res.reason === "blockers"
              ? (res.blockers ?? []).map((b) => b.message).join(" · ")
              : res.reason,
        });
      }
    } catch (err) {
      // Cookie expiré : inutile d'insister sur les suivantes, et c'est
      // exactement la panne qui a fait sortir l'envoi du cron.
      if (err instanceof DougsAuthError) {
        result.errors.push({
          contractName: item.contractName,
          label: item.label,
          message: err.message,
        });
        break;
      }
      result.errors.push({
        contractName: item.contractName,
        label: item.label,
        message: err instanceof Error ? err.message : "erreur inconnue",
      });
    }
  }

  revalidateTag(`dougs:${args.userId}`, { expire: 0 });
  revalidatePath("/coworking");
  revalidatePath("/compta");
  return result;
}
