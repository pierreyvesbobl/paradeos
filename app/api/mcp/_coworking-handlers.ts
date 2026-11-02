import { z } from "zod";
import { isCoworkingAutoSendEnabled } from "../../../lib/coworking/auto-send";
import { sendDueCoworkingInvoicesCore } from "../../../lib/coworking/send-due";
import { listDueCoworkingInvoices } from "../../../lib/db/queries/coworking";

/**
 * Envoi groupé des factures coworking dues, exposé en MCP : le même parcours
 * que le bouton de la page Coworking (brouillon Dougs, contrôle, finalisation,
 * mail du gabarit coworking avec le PDF, classement Drive).
 *
 * Deux temps, comme `send_document_to_client`. Sans `confirm`, on rend la liste
 * de ce qui partirait, sans toucher à Dougs. L'envoi exige `confirm: true` et
 * les `invoiceIds` relus : une facture devenue due entre-temps n'est pas
 * embarquée sans avoir été vue.
 */
export const sendDueCoworkingInvoicesMcpSchema = z.object({
  /** Factures à envoyer, prises dans la liste rendue sans `confirm`. */
  invoiceIds: z.array(z.string().uuid()).max(100).optional(),
  /** `true` = finalise et envoie. Absent ou `false` = liste seulement. */
  confirm: z.boolean().optional(),
});

export async function sendDueCoworkingInvoicesMcp(
  args: z.infer<typeof sendDueCoworkingInvoicesMcpSchema>,
  ctx: { userId: string },
) {
  const enabled = await isCoworkingAutoSendEnabled();

  if (args.confirm !== true) {
    const due = await listDueCoworkingInvoices();
    return {
      enabled,
      due,
      note: enabled
        ? "Rien n'a été envoyé. Montre cette liste à l'utilisateur (contrat, période, montant, destinataire). Sur son accord explicite, rappelle avec confirm=true et les invoiceIds des lignes sans blocker."
        : "L'envoi groupé est désactivé dans les réglages (COWORKING_AUTOSEND_ENABLED) : rien ne peut partir.",
    };
  }

  if (!args.invoiceIds || args.invoiceIds.length === 0) {
    throw new Error(
      "confirm=true exige les invoiceIds relus : appelle d'abord sans confirm pour obtenir la liste.",
    );
  }
  const result = await sendDueCoworkingInvoicesCore({
    userId: ctx.userId,
    invoiceIds: args.invoiceIds,
  });
  return {
    ...result,
    note: "Factures envoyées : finalisées chez Dougs, mail coworking avec le PDF parti au coworker. `blocked` et `errors` détaillent ce qui n'est pas parti.",
  };
}
