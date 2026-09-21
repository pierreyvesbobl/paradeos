/**
 * Décisions de tri sur le texte d'une facture, avant et après l'appel au
 * modèle. Module pur (pas de `server-only`) : c'est de la logique qu'on
 * veut pouvoir tester sans Drive ni LLM.
 */

/**
 * Découpe du texte envoyé au LLM. Les informations cherchées — émetteur,
 * date, numéro, totaux — vivent en tête et en pied de facture ; le ventre
 * du document, ce sont les lignes de détail, parfois des dizaines de
 * pages de consommation d'API. Les envoyer intégralement triple la
 * latence et le coût sans rien apporter.
 */
const HEAD_CHARS = 6_000;
const TAIL_CHARS = 2_500;

export function condenseInvoiceText(text: string): string {
  if (text.length <= HEAD_CHARS + TAIL_CHARS) return text;
  return `${text.slice(0, HEAD_CHARS)}\n\n[…lignes de détail omises…]\n\n${text.slice(-TAIL_CHARS)}`;
}

/**
 * Distingue « ce document ne sera jamais lisible » de « ça a raté cette
 * fois ». Le dossier comptable contient des reçus photographiés (`.jpg`)
 * et quelques PDF tronqués : les repasser au modèle trois fois coûte
 * trois téléchargements pour le même verdict. Un timeout, à l'inverse,
 * ne dit rien du document.
 */
export function isPermanentExtractionFailure(message: string): boolean {
  return /invalid pdf|no pdf header|pdf structure|unexpected end of file/i.test(message);
}
