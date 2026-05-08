import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { projects } from "./projects";
import { users } from "./users";

/**
 * Contacts CRM liés à un projet (M2M project ↔ contact), en plus du
 * `contact_id` primary sur `projects`. Plusieurs interlocuteurs
 * possibles pour un même projet.
 */
export const projectContacts = pgTable(
  "project_contacts",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.contactId] }),
    contactIdx: index("project_contacts_contact_idx").on(t.contactId),
  }),
);

export type ProjectContact = typeof projectContacts.$inferSelect;
