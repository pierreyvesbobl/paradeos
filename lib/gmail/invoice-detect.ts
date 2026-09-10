/**
 * Détection des mails susceptibles de porter une facture, et des PJ à
 * soumettre au classement. Module pur (pas de `server-only`) : partagé par
 * le sync Gmail et le rattrapage, et testable.
 */
import type { GmailAttachmentRef } from "@/lib/google/gmail-api";

/**
 * Un mail dont le sujet parle de facturation mérite qu'on télécharge son
 * contenu même sans match CRM : la plupart des factures d'achat viennent
 * de fournisseurs (EDF, OVH, SaaS…) qui ne sont pas des contacts du CRM,
 * et sans le `format=full` on n'a pas les références de PJ.
 *
 * Volontairement restrictif — le mot doit ressembler à du vocabulaire de
 * facturation, pas au "bien reçu" d'une conversation ordinaire. D'où
 * « reçu » seulement sous la forme « reçu de paiement » / « votre reçu ».
 */
const INVOICE_SUBJECT_RE =
  /(factur|invoice|billing|receipt|quittance|justificatif|note de d[ée]bit|avis d'[ée]ch[ée]ance|re[çc]u de paiement|votre re[çc]u)/i;

/**
 * Boîtes d'envoi dédiées à la facturation : `invoice+statements@` (Stripe),
 * `billing@`, `facturation@`… Couvre les sujets qui ne disent rien
 * (« Your Acme payment », « Document disponible »).
 */
const INVOICE_SENDER_RE =
  /^(invoices?|billing|factur(ation|es?)|receipts?|comptabilite|accounting)([+._-]|$)/i;

/**
 * Libellé Gmail (dernier segment) qui range les factures : « factures »,
 * « Compta/Invoices »… Posé par un filtre Gmail dès la réception, c'est le
 * signal le plus fiable qu'on ait sans ouvrir le mail.
 */
const INVOICE_LABEL_RE = /^(factures?|invoices?|receipts?|re[çc]us?|achats?)$/i;

export function looksLikeInvoiceMessage(args: {
  subject: string | null;
  fromEmail: string | null;
  /** Noms des libellés Gmail du message (pas les ids). */
  labelNames: string[];
}): boolean {
  if (args.subject && INVOICE_SUBJECT_RE.test(args.subject)) return true;
  const localPart = args.fromEmail?.split("@")[0] ?? "";
  if (localPart && INVOICE_SENDER_RE.test(localPart)) return true;
  return args.labelNames.some((name) => INVOICE_LABEL_RE.test(name.split("/").pop()?.trim() ?? ""));
}

/** Limite pour ne pas tenter de classer des PJ énormes (>20 MB). */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Filtre les PJ candidates au classement : PDF de taille raisonnable.
 * L'extension suffit, le mimeType n'est pas fiable — Stripe (Supabase,
 * OpenRouter…) envoie ses factures en `application/octet-stream`. Un faux
 * PDF échoue au parse et finit `rejected`, sans autre dégât.
 */
export function pickInvoicePdfs(refs: GmailAttachmentRef[]): GmailAttachmentRef[] {
  return refs.filter(
    (a) =>
      (a.mimeType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf")) &&
      a.size > 0 &&
      a.size <= MAX_PDF_BYTES,
  );
}
