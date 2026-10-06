import "server-only";

/**
 * Livraison d'un document comptable au client : **notre** mail, avec le PDF
 * légal de Dougs en pièce jointe.
 *
 * Partagé par les factures coworking, les factures projet et les devis — tous
 * doivent arriver sous la même marque. Vivait dans `lib/coworking/auto-send.ts`
 * tant que seul le coworking envoyait.
 */

import type { InvoiceBrand } from "@/db/schema/invoices";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import {
  DougsAuthError,
  type DougsSalesInvoice,
  downloadDougsFile,
  getDougsQuote,
  getDougsSalesInvoice,
  pickDougsFileUuid,
  sendDougsSalesInvoiceEmail,
} from "@/lib/dougs/client";
import { sendEmail } from "@/lib/email/client";
import { fileSalesInvoiceToDrive } from "./file-invoice-to-drive";

/** Forme minimale acceptée par les pickers de `lib/dougs/client`. */
export type DougsPayloadLike = DougsSalesInvoice;

/**
 * Envoie un document au client : **notre** mail, avec le PDF légal de Dougs en
 * pièce jointe.
 *
 * Pourquoi ne pas utiliser `actions/send-email` de Dougs : son mail est
 * générique et identique pour les trois marques, et son corps n'accepte que du
 * texte brut. En envoyant nous-mêmes on maîtrise l'objet, la mise en forme et
 * le nom d'expéditeur par marque — sans jamais produire un second document,
 * puisque la pièce jointe est le PDF que Dougs a généré et numéroté.
 *
 * Dougs reste le repli : si on n'arrive pas à récupérer le PDF ou si Resend
 * échoue, mieux vaut un mail générique que pas de facture.
 */
export async function deliverDocumentEmail(args: {
  userId: string;
  /** Facture **finalisée** ou devis finalisé. */
  documentId: string;
  /** `invoice` lit la facture, `quote` le devis : deux endpoints distincts. */
  documentKind: "invoice" | "quote";
  recipient: string;
  reference: string;
  brand: InvoiceBrand;
  /**
   * `html` absent = mail en texte brut, ce qui est le cas des documents client
   * rédigés à la main. Les envois automatiques fournissent les deux.
   */
  mail: { subject: string; body: string; html?: string };
  /**
   * Facture Paradeos à classer dans le Drive comptable une fois le mail parti.
   * Omis pour un devis : « Factures Ventes » n'est pas sa place.
   */
  archiveInvoiceId?: string;
  /** Nom du client, pour nommer le fichier déposé. */
  clientName?: string;
  /** Payload Dougs déjà en main, pour y lire l'UUID du PDF sans re-GET. */
  payload?: DougsPayloadLike | null;
}): Promise<{ via: "parade" | "dougs" }> {
  const template = brandTemplateFor(args.brand);

  // 1. Notre mail, avec le PDF légal joint.
  try {
    const source =
      args.payload ??
      (args.documentKind === "quote"
        ? await getDougsQuote(args.userId, args.documentId)
        : await getDougsSalesInvoice(args.userId, args.documentId));
    const fileUuid = pickDougsFileUuid(source);
    if (!fileUuid) throw new Error("PDF introuvable sur le document Dougs.");
    const pdf = await downloadDougsFile(args.userId, fileUuid);
    const filename = `${args.reference.replace(/[^\w.-]+/g, "-")}.pdf`;
    const res = await sendEmail({
      to: args.recipient,
      subject: args.mail.subject,
      ...(args.mail.html ? { html: args.mail.html } : {}),
      text: args.mail.body,
      fromName: template.senderName,
      tags: [{ name: "type", value: "invoice" }],
      attachments: [{ filename, content: pdf.buffer }],
    });
    // `sendEmail` ne lève jamais, et renvoie `ok: true` même en mode console
    // (où il se contente de logger). Pour une facture, « loggué » n'est pas
    // « envoyé » : on exige `delivered`, sinon on bascule sur le repli Dougs.
    // Sans ça, un EMAIL_DELIVERY mal réglé marquerait les factures comme
    // envoyées sans que le client reçoive quoi que ce soit.
    if (!res.delivered) {
      throw new Error(
        res.ok ? "Envoi Resend inactif (EMAIL_DELIVERY ≠ resend)." : "Resend a refusé l'envoi.",
      );
    }

    // Le client a sa facture : on en garde copie dans le Drive comptable.
    // Volontairement après l'envoi et sans `await` bloquant l'issue : un Drive
    // indisponible ne doit pas faire croire que le mail a échoué.
    if (args.archiveInvoiceId) {
      await fileSalesInvoiceToDrive({
        userId: args.userId,
        invoiceId: args.archiveInvoiceId,
        reference: args.reference,
        clientName: args.clientName ?? "",
        pdf: pdf.buffer,
      });
    }
    return { via: "parade" };
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    console.warn(
      `[auto-send] mail Parade impossible pour ${args.reference}, repli sur Dougs :`,
      err instanceof Error ? err.message : err,
    );
  }

  // 2. Repli : le mail générique de Dougs. Réservé aux factures — c'est la
  // seule ressource dont on connaisse le payload de `actions/send-email`, et
  // mieux vaut échouer franchement sur un devis que taper un endpoint non
  // vérifié.
  if (args.documentKind === "invoice") {
    await sendDougsSalesInvoiceEmail(args.userId, args.documentId, {
      to: args.recipient,
      subject: args.mail.subject,
      body: args.mail.body,
    });
    return { via: "dougs" };
  }
  throw new Error("Envoi du devis impossible : PDF ou expédition indisponible.");
}
