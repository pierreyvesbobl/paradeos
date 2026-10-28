import { words, wordsThen } from "./word-match";

/**
 * Mails qui attendent un geste de l'utilisateur, reconnus à l'objet : un
 * paiement refusé, une pièce à signer, un compte à confirmer, un domaine
 * qui expire. Les robots ne passent plus par l'extraction LLM (cf.
 * automated-sender.ts), ces motifs sont donc leur seul signal ; pour les
 * mails humains, `extraction_meta.needsReply` fait le même travail.
 *
 * Principe : tout ce qui demande une action reste dans la boîte. Le doute
 * profite au maintien, un faux positif ne coûte qu'un fil de plus à
 * ranger à la main.
 */

const SUBJECT_PATTERNS: RegExp[] = [
  words("action (?:requise|required|needed|nécessaire)"),
  words("(?:à|a) (?:confirmer|valider|signer|compléter|renouveler|régulariser|payer)"),
  words(
    "(?:please|veuillez|merci de) (?:confirm|verify|review|respond|reply|sign|update|complete|renew|confirmer|vérifier|valider|signer|répondre|mettre à jour|compléter|renouveler)",
  ),
  words("(?:confirm|verify|validate|confirmez|vérifiez|validez) (?:your|votre|vos|ton|ta)"),
  wordsThen(
    "paiement|payment|prélèvement|règlement|virement",
    "refus|échou|failed|declined|unsuccessful|impay|retard|overdue|en attente|pending|requis|required",
  ),
  wordsThen(
    "failed|échec|échoué|refusé|declined|rejected|rejeté",
    "payment|paiement|charge|prélèvement|transfer|virement|invoice|facture",
  ),
  words("impayées?|unpaid|overdue|en retard|past due|relance|rappel de paiement|payment reminder"),
  words("expire|expiration|expiring|expired|arrive à échéance|échéance|renouvellement|renewal"),
  words(
    "suspendue?|suspension|suspended|désactivée?|deactivated|bloquée?|blocked|restreint|restricted",
  ),
  words("litige|dispute|chargeback|contestation|réclamation"),
  words("signature|à signer|to sign|signez|sign the|docusign|yousign"),
  words("(?:quota|limite|limit) (?:atteinte?|dépassée?|reached|exceeded)"),
  words(
    "réponse (?:attendue|requise)|awaiting your (?:reply|response|approval)|needs your (?:approval|attention|review)|requires your",
  ),
  words("approbation|approval|approve|approuver|autorisation|authorize|authorization"),
  words("urgent|dernier rappel|final (?:reminder|notice)|last chance|deadline|date limite"),
  words("approaching your limits?|upgrade now|service disruption|interruption de service"),
  words("mise à jour (?:requise|nécessaire)|update (?:required|needed)|upgrade required"),
  words(
    "(?:vérification|verification) (?:requise|required|needed|de (?:votre|ton) (?:compte|identité))",
  ),
];

export type ActionMailLike = { subject: string | null | undefined };

/** Un incident clos n'attend plus rien, quel que soit le reste de l'objet. */
const RESOLVED_PATTERN = /^\s*\[?\s*(?:resolved|résolu|closed|clôturé|fixed)\b/iu;

/** Vrai pour un objet qui annonce quelque chose à faire. */
export function requiresAction(mail: ActionMailLike): boolean {
  const subject = mail.subject?.trim() ?? "";
  if (subject === "" || RESOLVED_PATTERN.test(subject)) return false;
  return SUBJECT_PATTERNS.some((re) => re.test(subject));
}
