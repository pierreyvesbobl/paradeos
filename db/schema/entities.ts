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

/** Adresse postale telle que stockée en jsonb sur `entities` et `contacts`. */
export type EntityAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

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
    /** 14 chiffres. Le SIREN seul ne suffit pas à router une facture
     *  électronique vers le bon établissement destinataire. Cf. migration 0075. */
    siret: text("siret"),
    /** Dénomination sociale, quand elle diffère du nom d'usage (`name`).
     *  C'est elle qui doit figurer sur la facture. */
    legalName: text("legal_name"),
    vatNumber: text("vat_number"),
    address: jsonb("address").$type<EntityAddress | null>(),
    /** Adresse de livraison, exigée par la facture électronique quand elle
     *  diffère de l'adresse de facturation. */
    deliveryAddress: jsonb("delivery_address").$type<EntityAddress | null>(),
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
