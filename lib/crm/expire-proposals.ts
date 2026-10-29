import "server-only";

import { and, eq, exists, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { emailProposals, gmailMessages } from "@/db/schema/gmail";
import { meetingProposals } from "@/db/schema/meetings";
import { isAutomatedSender } from "@/lib/gmail/automated-sender";
import { isReplyTask } from "@/lib/gmail/reply-tasks";

/**
 * Au-delà de ce délai, une proposition que personne n'a tranchée n'a plus
 * de contexte : le mail ou la réunion a été traité ou oublié. Elle sort de
 * la file sans compter pour un refus (statut `expired`, distinct de
 * `rejected`), et une ré-extraction de la source peut la reposer.
 */
export const PROPOSAL_TTL_DAYS = 7;

function cutoffFor(opts: { now?: Date; ttlDays?: number }): { now: Date; cutoff: Date } {
  const now = opts.now ?? new Date();
  return {
    now,
    cutoff: new Date(now.getTime() - (opts.ttlDays ?? PROPOSAL_TTL_DAYS) * 86_400_000),
  };
}

/**
 * Passe en `expired` les propositions email encore `pending` plus vieilles
 * que `PROPOSAL_TTL_DAYS`, pour la boîte d'un utilisateur. Appelée à chaque
 * relève Gmail. Retourne le nombre de lignes touchées.
 */
export async function expireStaleEmailProposals(
  conn: Database,
  opts: { userId: string; now?: Date; ttlDays?: number },
): Promise<number> {
  const { now, cutoff } = cutoffFor(opts);
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

/**
 * Les propositions nées d'un mail de robot (reçu, alerte, newsletter)
 * expirent sans attendre : l'extraction ne les produit plus depuis que les
 * expéditeurs machines sont écartés, celles-ci datent d'avant, ou d'un
 * expéditeur que la détection a appris depuis. Jamais un refus : rien à
 * apprendre d'une proposition que personne n'aurait dû voir.
 */
export async function expireAutomatedSenderProposals(
  conn: Database,
  opts: { userId: string; now?: Date },
): Promise<number> {
  const rows = await conn
    .select({
      id: emailProposals.id,
      fromEmail: gmailMessages.fromEmail,
      fromName: gmailMessages.fromName,
    })
    .from(emailProposals)
    .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
    .where(and(eq(emailProposals.status, "pending"), eq(gmailMessages.userId, opts.userId)));
  const ids = rows.filter((r) => isAutomatedSender(r)).map((r) => r.id);
  if (ids.length === 0) return 0;
  await conn
    .update(emailProposals)
    .set({ status: "expired", decidedAt: opts.now ?? new Date() })
    .where(inArray(emailProposals.id, ids));
  return ids.length;
}

/**
 * « Répondre à Frédéric » proposé d'après un mail auquel l'utilisateur a
 * répondu depuis : fait par construction. Idem pour un brouillon de
 * réponse. On regarde les messages envoyés (libellé Gmail `SENT`) plus
 * récents que celui qui a fait naître la proposition. Les autres tâches
 * du même mail (« faire la demande d'agrément ») ne sont pas touchées.
 */
export async function expireAnsweredProposals(
  conn: Database,
  opts: { userId: string; now?: Date },
): Promise<number> {
  const later = conn
    .select({ id: sql`1` })
    .from(sql`${gmailMessages} as later`)
    .where(
      and(
        sql`later.thread_id = ${gmailMessages.threadId}`,
        sql`later.internal_date > ${gmailMessages.internalDate}`,
        sql`'SENT' = any(later.labels)`,
      ),
    );
  const rows = await conn
    .select({ id: emailProposals.id, kind: emailProposals.kind, payload: emailProposals.payload })
    .from(emailProposals)
    .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
    .where(
      and(
        eq(emailProposals.status, "pending"),
        eq(gmailMessages.userId, opts.userId),
        inArray(emailProposals.kind, ["task", "draft_reply"]),
        exists(later),
      ),
    );
  const ids = rows
    .filter(
      (r) =>
        r.kind === "draft_reply" ||
        isReplyTask((r.payload as { title?: unknown } | null)?.title as string | null),
    )
    .map((r) => r.id);
  if (ids.length === 0) return 0;
  await conn
    .update(emailProposals)
    .set({ status: "expired", decidedAt: opts.now ?? new Date() })
    .where(inArray(emailProposals.id, ids));
  return ids.length;
}

/**
 * Même règle pour les propositions de réunion. Elles ne sont pas scopées
 * par utilisateur (une réunion est partagée) : une passe suffit, quel que
 * soit l'appelant.
 */
export async function expireStaleMeetingProposals(
  conn: Database,
  opts: { now?: Date; ttlDays?: number } = {},
): Promise<number> {
  const { now, cutoff } = cutoffFor(opts);
  const rows = await conn
    .update(meetingProposals)
    .set({ status: "expired", decidedAt: now })
    .where(and(eq(meetingProposals.status, "pending"), lt(meetingProposals.createdAt, cutoff)))
    .returning({ id: meetingProposals.id });
  return rows.length;
}
