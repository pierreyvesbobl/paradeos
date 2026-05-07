import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const meetingStatus = pgEnum("meeting_status", [
  "ingested", // transcript stocké, pas encore extrait
  "extracted", // résumé + propositions générés, en attente de revue
  "reviewed", // toutes propositions traitées
  "archived",
]);

export const meetingProposalKind = pgEnum("meeting_proposal_kind", [
  "task",
  "project",
  "opportunity",
  "contact",
  "entity",
]);

export const meetingProposalStatus = pgEnum("meeting_proposal_status", [
  "pending",
  "accepted",
  "rejected",
]);

/**
 * Transcripts de meetings importés manuellement, avec résumé Claude/GPT
 * et propositions d'extraction (tâches, contacts, opportunités…) à
 * valider par un humain.
 */
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    /** Transcript brut (texte). Pour les fichiers volumineux on passera
     * par Vercel Blob plus tard. */
    transcript: text("transcript").notNull(),
    /** Résumé en markdown généré par le LLM, éditable côté UI. */
    summary: text("summary"),
    status: meetingStatus("status").notNull().default("ingested"),
    /** Source d'origine si fournie (Drive, upload local, copier-coller…). */
    sourceLabel: text("source_label"),
    /** Lien optionnel vers un projet (couvre aussi les anciens deals/opps). */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    statusIdx: index("meetings_status_idx").on(table.status),
    occurredAtIdx: index("meetings_occurred_at_idx").on(table.occurredAt),
    projectIdx: index("meetings_project_idx").on(table.projectId),
  }),
);

/**
 * Propositions extraites par le LLM. Chaque proposition est typée
 * (`kind`) et porte son `payload` JSONB. Le `matchedId` pointe vers un
 * record existant (entité/contact/projet) si fuzzy match concluant.
 *
 * Workflow :
 *   1. status='pending' → l'humain voit la proposition dans /meetings/[id]
 *   2. accept → on crée (ou lie) le record + status='accepted'
 *   3. reject → status='rejected', trace conservée
 */
export const meetingProposals = pgTable(
  "meeting_proposals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    kind: meetingProposalKind("kind").notNull(),
    payload: jsonb("payload").notNull(),
    /** Si match fuzzy concluant : id du record existant à lier. */
    matchedId: uuid("matched_id"),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    status: meetingProposalStatus("status").notNull().default("pending"),
    /** Si accepté et record créé : son id (selon kind, pointe sur la
     * bonne table — pas de FK car polymorphe). */
    createdEntityId: uuid("created_entity_id"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    meetingIdx: index("meeting_proposals_meeting_idx").on(table.meetingId),
    statusIdx: index("meeting_proposals_status_idx").on(table.status),
  }),
);

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingProposal = typeof meetingProposals.$inferSelect;
export type NewMeetingProposal = typeof meetingProposals.$inferInsert;
