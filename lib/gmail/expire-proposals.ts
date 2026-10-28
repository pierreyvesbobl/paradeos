import "server-only";

import { and, eq, inArray, lt } from "drizzle-orm";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages } from "@/db/schema/gmail";

/**
 * Au-delà de ce délai, une proposition que personne n'a tranchée n'a plus
 * de contexte : le mail a été traité ou oublié. Elle sort de la file sans
 * compter pour un refus (statut `expired`, distinct de `rejected`), et une
 * ré-extraction du message peut la reposer.
 */
export const PROPOSAL_TTL_DAYS = 7;

/**
 * Passe en `expired` les propositions email encore `pending` plus vieilles
 * que `PROPOSAL_TTL_DAYS`. Appelée à chaque relève Gmail. Retourne le
 * nombre de lignes touchées.
 */
export async function expireStaleEmailProposals(
  conn: Database,
  opts: { userId: string; now?: Date; ttlDays?: number },
): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.ttlDays ?? PROPOSAL_TTL_DAYS) * 86_400_000);
  const rows = await conn
    .update(emailProposals)
    .set({ status: "expired", decidedAt: now })
    .where(
      and(
        eq(emailProposals.status, "pending"),
        lt(emailProposals.createdAt, cutoff),
        inArray(
          emailProposals.messageId,
          conn
            .select({ id: gmailMessages.id })
            .from(gmailMessages)
            .where(eq(gmailMessages.userId, opts.userId)),
        ),
      ),
    )
    .returning({ id: emailProposals.id });
  return rows.length;
}
