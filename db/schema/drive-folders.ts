import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { driveFileSubjectType } from "./drive-files";
import { googleAccounts } from "./google-accounts";
import { users } from "./users";

/**
 * Lien polymorphique vers un dossier Google Drive pour un sujet métier
 * (un projet, une entité, etc.). Un sujet a au plus un dossier lié
 * (UNIQUE sur (subject_type, subject_id)).
 *
 * On stocke le chemin résolu (`folder_path`, ex. `My Drive/Clients/Acme`)
 * pour pouvoir construire le chemin local Google Drive Desktop sans
 * refaire la chaîne de parents à chaque rendu.
 */
export const driveFolders = pgTable(
  "drive_folders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    googleAccountId: uuid("google_account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    subjectType: driveFileSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    folderId: text("folder_id").notNull(),
    folderName: text("folder_name").notNull(),
    folderUrl: text("folder_url"),
    /** Chemin lisible affiché à l'user. Ex. "My Drive/Foo/Bar" ou
     * "Raccourci → Parade/Automato/Projets/X". */
    folderPath: text("folder_path"),
    /** Chemin Drive Desktop relatif au dossier de mount
     * (~/Library/CloudStorage/GoogleDrive-<email>/), tel quel. Ex.
     * "My Drive/Foo/Bar" ou ".shortcut-targets-by-id/<id>/Parade/...". */
    folderLocalPath: text("folder_local_path"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    subjectUnique: uniqueIndex("drive_folders_subject_unique").on(t.subjectType, t.subjectId),
  }),
);

export type DriveFolder = typeof driveFolders.$inferSelect;
export type NewDriveFolder = typeof driveFolders.$inferInsert;
