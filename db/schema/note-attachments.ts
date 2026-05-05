import { sql } from "drizzle-orm";
import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { users } from "./users";

/**
 * Pièces jointes des notes. Le binaire vit dans Supabase Storage
 * (bucket `note-attachments`). Cette table garde la métadonnée +
 * le chemin pour générer une signed URL au moment du téléchargement.
 */
export const noteAttachments = pgTable(
  "note_attachments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    /** Chemin Storage : `<note_id>/<uuid>-<filename>` */
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    noteIdx: index("note_attachments_note_idx").on(table.noteId),
  }),
);

export type NoteAttachment = typeof noteAttachments.$inferSelect;
export type NewNoteAttachment = typeof noteAttachments.$inferInsert;
