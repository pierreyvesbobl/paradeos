import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { googleAccounts } from "./google-accounts";
import { users } from "./users";

export const driveFileSubjectType = pgEnum("drive_file_subject_type", [
  "entity",
  "contact",
  "project",
  "note",
  "meeting",
]);

/**
 * Fichiers Google Drive rattachés à un sujet métier (projet, entité,
 * contact, note, meeting). Le contenu reste dans Drive — on ne stocke
 * ici que les métadonnées + le `file_id` Google pour reconstruire les
 * liens et rafraîchir les infos.
 *
 * Une même paire (file_id, subject) est unique : pas d'attache double
 * sur un même sujet.
 *
 * `google_account_id` permet, lors d'un re-fetch (renommage, suppression
 * détectée…), de savoir quel compte utiliser pour rafraîchir le
 * `access_token`.
 */
export const driveFiles = pgTable(
  "drive_files",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    googleAccountId: uuid("google_account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    subjectType: driveFileSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    fileId: text("file_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    iconLink: text("icon_link"),
    webViewLink: text("web_view_link"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    bySubject: index("drive_files_subject_idx").on(t.subjectType, t.subjectId),
    uniquePerSubject: uniqueIndex("drive_files_file_subject_unique").on(
      t.fileId,
      t.subjectType,
      t.subjectId,
    ),
  }),
);

export type DriveFile = typeof driveFiles.$inferSelect;
export type NewDriveFile = typeof driveFiles.$inferInsert;
