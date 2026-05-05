import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { users } from "./users";

/**
 * Personnes physiques. Un contact peut être rattaché à 0 ou 1 entité.
 * Pour le multi-rattachement (consultant qui bosse pour 2 boîtes), on
 * ajoutera une table `contact_entity_roles` quand le besoin se présentera.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    linkedinUrl: text("linkedin_url"),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    notes: text("notes"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    // Indexes trigram créés côté Supabase migration (pg_trgm).
    emailLowerIdx: index("contacts_email_lower_idx").on(sql`lower(${table.email})`),
    entityIdx: index("contacts_entity_idx").on(table.entityId),
    ownerIdx: index("contacts_owner_idx").on(table.ownerId),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
