import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";

/**
 * Adresses e-mail **secondaires** d'un contact. L'adresse principale reste
 * `contacts.email` : c'est elle qu'on affiche, qu'on trie, et à laquelle on
 * envoie (factures coworking, documents). Une personne qui écrit depuis
 * plusieurs boîtes (pro, perso, ancienne société) doit quand même être
 * reconnue par tout ce qui rapproche sur l'email — sync Gmail, réunions,
 * LinkedIn, dédoublonnage. Ces rapprochements passent par
 * `lib/crm/contact-emails.ts`, qui regarde les deux sources.
 *
 * Une adresse n'appartient qu'à un contact (index unique sur `lower(email)`) ;
 * la collision avec une adresse principale est vérifiée côté app
 * (`assertEmailFreeFor`).
 */
export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** Libellé libre : « perso », « ancienne boîte »… */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    emailLowerUnique: uniqueIndex("contact_emails_email_lower_unique").on(
      sql`lower(${table.email})`,
    ),
    contactIdx: index("contact_emails_contact_idx").on(table.contactId),
  }),
);

export type ContactEmail = typeof contactEmails.$inferSelect;
export type NewContactEmail = typeof contactEmails.$inferInsert;
