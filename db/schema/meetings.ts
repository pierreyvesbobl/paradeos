import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const meetingStatus = pgEnum("meeting_status", [
  "ingested", // transcript stocké, pas encore extrait
  "extracted", // résumé + propositions générés, en attente de revue
  "reviewed", // toutes propositions traitées
  "archived",
]);

/**
 * État du pipeline de transcription quand la source est un audio uploadé.
 *  - `idle`    : pas d'audio, ou audio attaché mais pas encore traité
 *  - `running` : Whisper en cours
 *  - `done`    : transcript rempli depuis l'audio
 *  - `error`   : échec, voir `transcription_error`
 */
export const meetingTranscriptionStatus = pgEnum("meeting_transcription_status", [
  "idle",
  "running",
  "done",
  "error",
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
    /** Transcript brut (texte). Peut être null tant que la transcription
     * d'un audio uploadé n'a pas abouti — sinon rempli soit par paste,
     * soit par Whisper. */
    transcript: text("transcript"),
    /** Résumé en markdown généré par le LLM, éditable côté UI. */
    summary: text("summary"),
    status: meetingStatus("status").notNull().default("ingested"),
    /** Source d'origine si fournie (Drive, upload local, copier-coller…). */
    sourceLabel: text("source_label"),
    /** Audio source (bucket `meeting-audio`) si la réunion a été importée
     * sous forme de fichier audio. Le transcript est alors généré via
     * Whisper. Un seul audio par réunion en MVP. */
    audioStoragePath: text("audio_storage_path"),
    audioFileName: text("audio_file_name"),
    audioMimeType: text("audio_mime_type"),
    audioSizeBytes: integer("audio_size_bytes"),
    transcriptionStatus: meetingTranscriptionStatus("transcription_status")
      .notNull()
      .default("idle"),
    /** Si `transcription_status='error'`, message lisible affiché en UI. */
    transcriptionError: text("transcription_error"),
    /** Identifiant tech du modèle utilisé, ex. `openai-whisper-1`. */
    transcriptionProvider: text("transcription_provider"),
    /** Si ingéré depuis le watch d'un dossier Drive, ID du fichier source.
     * Utilisé pour l'idempotence (cf. unique index partiel). */
    sourceDriveFileId: text("source_drive_file_id"),
    sourceDriveFileModifiedAt: timestamp("source_drive_file_modified_at", { withTimezone: true }),
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
