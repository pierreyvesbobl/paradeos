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
 * Adresses en copie, normalisées : minuscules, sans doublon, triées. Deux
 * listes équivalentes donnent la même empreinte, quel que soit l'ordre saisi.
 */
export function normalizeCc(cc: readonly string[] | null | undefined): string[] {
  if (!cc) return [];
  return [...new Set(cc.map((a) => a.trim().toLowerCase()).filter(Boolean))].sort();
}

/**
 * Empreinte du message soumis. Sert de garde : l'envoi au client n'est autorisé
 * que si un aperçu **du même message** est parti avant. Normalise les espaces
 * de bord pour qu'un retour à la ligne de plus ne force pas un nouvel aperçu.
 *
 * Les adresses en copie font partie de l'empreinte : ajouter un tiers après
 * l'aperçu change qui reçoit le document, donc exige une nouvelle relecture.
 * Sans copie, l'empreinte est celle d'avant : les aperçus déjà enregistrés
 * restent valables.
 */
export function messageDigest(subject: string, body: string, cc?: readonly string[]): string {
  const copies = normalizeCc(cc);
  const suffix = copies.length > 0 ? `\n\ncc:${copies.join(",")}` : "";
  return createHash("sha256").update(`${subject.trim()}\n\n${body.trim()}${suffix}`).digest("hex");
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
