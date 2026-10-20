import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gmailMessages, gmailThreads } from "./gmail";
import { users } from "./users";

export const candidatureReplyStatus = pgEnum("candidature_reply_status", [
  "pending", // repéré au sync, en attente de confirmation LLM + réponse
  "replied", // réponse envoyée, fil libellé et archivé
  "rejected", // pas une candidature, ou fil déjà traité
  "error",
]);

/**
 * Journal de l'agent candidatures : un mail repéré comme candidature
 * (spontanée, stage, alternance…) reçoit automatiquement la réponse
 * « pas de poste ouvert », puis son fil est libellé et archivé.
 *
 * Une ligne par message repéré, jamais plus d'une réponse par fil : une
 * relance du même candidat retombe en `rejected` avec la raison.
 */
export const candidatureReplies = pgTable(
  "candidature_replies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => gmailThreads.id, { onDelete: "cascade" }),
    candidateEmail: text("candidate_email"),
    candidateName: text("candidate_name"),
    status: candidatureReplyStatus("status").notNull().default("pending"),
    /** Confiance du LLM que c'est bien une candidature (0–1). */
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    /** Résumé LLM, ou raison du rejet. */
    reason: text("reason"),
    /** Id Gmail du message de réponse envoyé. */
    sentGmailMessageId: text("sent_gmail_message_id"),
    errorMessage: text("error_message"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    messageUnique: uniqueIndex("candidature_replies_message_unique").on(table.messageId),
    userStatusIdx: index("candidature_replies_user_status_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    threadIdx: index("candidature_replies_thread_idx").on(table.threadId),
  }),
);

export type CandidatureReply = typeof candidatureReplies.$inferSelect;
