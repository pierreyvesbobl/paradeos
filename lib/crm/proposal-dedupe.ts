import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { emailProposals } from "@/db/schema/gmail";
import { meetingProposals } from "@/db/schema/meetings";
import { type ProposalKind, payloadKey } from "@/lib/crm/proposal-keys";
import { db } from "@/lib/db/server";

/**
 * Dédoublonnage des propositions **entre sources**.
 *
 * Le cas réel : deux mails d'un même fil, ou deux réunions de la même
 * semaine, parlent de la même société inconnue. Chaque extraction crée sa
 * proposition « créer l'entité X » avec `matchedId = null` (personne n'a
 * encore accepté, donc rien à matcher en base). On se retrouve avec deux
 * lignes identiques dans /inbox, et si les deux sont acceptées, deux
 * entités en base — c'est exactement l'enchaînement qui a produit
 * « MKP Doctor » puis « mkpdoctor » à 25 secondes d'intervalle.
 *
 * On écarte donc une proposition de création dont l'équivalent est **déjà
 * en attente** ailleurs. Rejeter celle qui reste fait disparaître les deux,
 * ce qui est le comportement voulu : rejeter veut dire « ne pas créer ça ».
 */

export { payloadKey, proposalDedupeKey } from "@/lib/crm/proposal-keys";

/**
 * Vrai si une proposition `pending` de même kind et même clé existe déjà,
 * côté email **ou** côté meeting, hors de la source en cours d'extraction.
 *
 * Le volume de propositions pending se compte en dizaines : on les charge
 * et on compare les clés en mémoire, avec la même implémentation que le
 * reste du dédoublonnage.
 */
export async function hasPendingProposalElsewhere(args: {
  kind: ProposalKind;
  key: string;
  /** Meeting en cours de ré-extraction — ses propres lignes sont ignorées. */
  excludeMeetingId?: string;
  /** Message en cours de ré-extraction — ses propres lignes sont ignorées. */
  excludeMessageId?: string;
}): Promise<boolean> {
  if (!args.key) return false;
  const conn = await db();

  const emailRows = await conn
    .select({ payload: emailProposals.payload, messageId: emailProposals.messageId })
    .from(emailProposals)
    .where(
      args.excludeMessageId
        ? and(
            eq(emailProposals.status, "pending"),
            eq(emailProposals.kind, args.kind),
            ne(emailProposals.messageId, args.excludeMessageId),
          )
        : and(eq(emailProposals.status, "pending"), eq(emailProposals.kind, args.kind)),
    );
  if (emailRows.some((r) => payloadKey(args.kind, r.payload) === args.key)) return true;

  const meetingRows = await conn
    .select({ payload: meetingProposals.payload, meetingId: meetingProposals.meetingId })
    .from(meetingProposals)
    .where(
      args.excludeMeetingId
        ? and(
            eq(meetingProposals.status, "pending"),
            eq(meetingProposals.kind, args.kind),
            ne(meetingProposals.meetingId, args.excludeMeetingId),
          )
        : and(eq(meetingProposals.status, "pending"), eq(meetingProposals.kind, args.kind)),
    );
  return meetingRows.some((r) => payloadKey(args.kind, r.payload) === args.key);
}
