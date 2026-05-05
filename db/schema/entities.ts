import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const entityKind = pgEnum("entity_kind", [
  "client",
  "prospect",
  "partner",
  "supplier",
  "other",
]);

/**
 * Entités morales suivies par Parade : clients, prospects, partenaires,
 * fournisseurs. À ne pas confondre avec `projects.kind` (client/product/transverse)
 * qui qualifie les projets internes.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    kind: entityKind("kind").notNull().default("prospect"),
    website: text("website"),
    siren: text("siren"),
    vatNumber: text("vat_number"),
    address: jsonb("address").$type<{
      street?: string;
      postalCode?: string;
      city?: string;
      country?: string;
    } | null>(),
    notes: text("notes"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    // L'index trigram (`entities_name_trgm_idx`) est créé côté Supabase
    // migration (cf. 0003_entities_contacts.sql) car il dépend de
    // l'extension pg_trgm.
    kindIdx: index("entities_kind_idx").on(table.kind),
    ownerIdx: index("entities_owner_idx").on(table.ownerId),
  }),
);

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
