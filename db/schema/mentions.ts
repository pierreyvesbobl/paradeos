import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { users } from "./users";

/**
 * Mentions @user dans une note. Indexées au moment de l'enregistrement
 * de la note (cf. `lib/actions/notes.ts`). Sert à la cloche topbar
 * (compteur unread) et à la liste "Mentions me concernant".
 *
 * Mentions #subject:slug ne sont pas stockées ici (elles sont juste
 * rendues comme liens) car elles ne déclenchent pas de notification.
 */
export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    /** User mentionné (cible de la notification). */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Auteur de la note (pour distinguer self-mentions). */
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    noteUserUnique: uniqueIndex("mentions_note_user_unique").on(table.noteId, table.userId),
    userUnreadIdx: index("mentions_user_unread_idx").on(table.userId, table.readAt),
  }),
);

export type Mention = typeof mentions.$inferSelect;
export type NewMention = typeof mentions.$inferInsert;
