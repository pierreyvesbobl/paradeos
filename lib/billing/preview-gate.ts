/**
 * Garde d'aperçu des documents client. Module pur — pas de DB, pas d'API, pour
 * que la règle soit testable isolément.
 *
 * On n'adresse pas un devis ni une facture à un client sans que quelqu'un ait
 * relu ce qui part. Dans l'UI la confirmation n'était qu'un second clic ; via
 * MCP un agent pouvait poser `confirm: true` du premier coup. En faisant de
 * l'aperçu une condition enregistrée, la confirmation devient vérifiable.
 */

import { createHash } from "node:crypto";

/**
 * Empreinte du message soumis. Sert de garde : l'envoi au client n'est autorisé
 * que si un aperçu **du même message** est parti avant. Normalise les espaces
 * de bord pour qu'un retour à la ligne de plus ne force pas un nouvel aperçu.
 */
export function messageDigest(subject: string, body: string): string {
  return createHash("sha256").update(`${subject.trim()}\n\n${body.trim()}`).digest("hex");
}

/**
 * Refuse l'envoi tant que personne n'a relu ce qui part.
 *
 * C'est le garde-fou qui rend la confirmation **vérifiable** plutôt que
 * déclarative : dans l'UI un second clic suffisait, et via MCP un agent pouvait
 * poser `confirm: true` du premier coup. Ici la condition est enregistrée en
 * base, donc ni l'un ni l'autre ne peut la contourner.
 */
export function assertPreviewed(args: {
  noun: string;
  previewDigest: string | null;
  previewSentAt: Date | null;
  digest: string;
}): void {
  if (!args.previewSentAt || !args.previewDigest) {
    throw new Error(
      `Envoie d'abord un aperçu de ce ${args.noun} : personne n'a encore relu ce que le client recevra.`,
    );
  }
  if (args.previewDigest !== args.digest) {
    throw new Error(
      `Le message a changé depuis l'aperçu. Renvoie un aperçu du ${args.noun} avant de l'adresser au client.`,
    );
  }
}
