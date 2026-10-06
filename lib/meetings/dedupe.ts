import "server-only";

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { meetingTitleKey } from "@/lib/meetings/dedupe-keys";

export { meetingTitleKey, transcriptFingerprint } from "@/lib/meetings/dedupe-keys";

/**
 * Dédoublonnage des réunions ingérées.
 *
 * `source_drive_file_id` et `source_email_message_id` garantissent qu'une
 * *source* ne produit qu'une réunion. Ils ne disent rien du cas réel :
 * le même compte-rendu arrive deux fois par deux chemins différents.
 * Une ancienne chaîne de classement Drive recopie les fichiers (nouvel
 * id, contenu identique), un transcript est transféré par mail *et*
 * déposé sur Drive, quelqu'un recolle à la main ce que la cron a déjà
 * pris. À chaque fois : deux fiches, deux extractions LLM payées, deux
 * jeux de propositions à trier dans /inbox.
 *
 * Deux garde-fous, dans cet ordre :
 *
 *  1. **Empreinte du contenu** (`content_fingerprint`) — doublée d'un
 *     index unique partiel en base, donc vraie même quand deux crons
 *     tournent en même temps. Attrape la copie à l'octet près, quel que
 *     soit le nom du fichier.
 *  2. **Même créneau, même titre** — attrape la copie dont le contenu a
 *     bougé (transcript régénéré, en-tête ajouté) mais qui désigne la
 *     même réunion. On exige l'égalité de `occurred_at` à la minute :
 *     deux réunions distinctes le même jour avec les mêmes personnes
 *     existent, à la même minute non.
 */

export type DuplicateMeeting = {
  id: string;
  title: string;
  /** Ce qui a fait conclure au doublon, repris tel quel dans les logs. */
  reason: "fingerprint" | "same-slot";
};

/**
 * Cherche une réunion déjà en base qui désigne la même chose.
 *
 * `limit` sur le créneau : `occurred_at` est indexé et l'égalité à la
 * minute ne ramène qu'une poignée de lignes ; la borne n'est là que pour
 * qu'un import massif horodaté à la même seconde ne relise pas la table.
 */
export async function findDuplicateMeeting(args: {
  fingerprint: string | null;
  title: string;
  occurredAt: Date | null;
  /** Réunion en cours de traitement, à ne pas confondre avec son propre doublon. */
  excludeMeetingId?: string;
}): Promise<DuplicateMeeting | null> {
  const conn = await db();

  if (args.fingerprint) {
    const where = args.excludeMeetingId
      ? and(
          eq(meetings.contentFingerprint, args.fingerprint),
          ne(meetings.id, args.excludeMeetingId),
        )
      : eq(meetings.contentFingerprint, args.fingerprint);
    const [hit] = await conn
      .select({ id: meetings.id, title: meetings.title })
      .from(meetings)
      .where(where)
      .limit(1);
    if (hit) return { id: hit.id, title: hit.title, reason: "fingerprint" };
  }

  const key = meetingTitleKey(args.title);
  if (!args.occurredAt || key.length === 0) return null;

  const slotFilters = [eq(meetings.occurredAt, args.occurredAt), isNotNull(meetings.occurredAt)];
  if (args.excludeMeetingId) slotFilters.push(ne(meetings.id, args.excludeMeetingId));
  const sameSlot = await conn
    .select({ id: meetings.id, title: meetings.title })
    .from(meetings)
    .where(and(...slotFilters))
    .orderBy(sql`${meetings.createdAt} asc`)
    .limit(20);

  const hit = sameSlot.find((row) => meetingTitleKey(row.title) === key);
  return hit ? { id: hit.id, title: hit.title, reason: "same-slot" } : null;
}
