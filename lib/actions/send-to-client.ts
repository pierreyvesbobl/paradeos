"use server";

/**
 * Enveloppes « server action » de l'envoi de documents au client.
 *
 * La logique vit dans `lib/billing/send-document.ts`, qui prend un `userId`
 * explicite : elle est partagée avec les outils MCP, dont les requêtes n'ont
 * pas de session Supabase. Ces actions n'ajoutent que la validation d'entrée
 * et la résolution de l'utilisateur courant.
 */

import { z } from "zod";
import { action } from "@/lib/actions/action";
import { sendProjectInvoiceCore, sendProjectQuoteCore } from "@/lib/billing/send-document";

const schema = z.object({
  invoiceId: z.string().uuid(),
  /** `true` = finalise et envoie au client. `false` = aperçu, rien n'est émis. */
  send: z.boolean().default(false),
  previewTo: z.string().email().optional(),
  /** Objet et corps rédigés par l'utilisateur. Le document part en pièce jointe. */
  subject: z.string().trim().min(1, "Objet requis.").max(300),
  body: z.string().trim().min(1, "Message requis.").max(10000),
});

// `async` obligatoire : Next refuse une server action synchrone, même quand
// elle ne fait que déléguer.
export const sendProjectInvoiceToClient = action(schema, async ({ input, user }) =>
  sendProjectInvoiceCore({ ...input, userId: user.id }),
);

export const sendProjectQuoteToClient = action(schema, async ({ input, user }) =>
  sendProjectQuoteCore({ ...input, userId: user.id }),
);
