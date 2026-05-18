import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { entities } from "./entities";
import { users } from "./users";

export const projectKind = pgEnum("project_kind", ["client", "product", "transverse"]);

/**
 * Statuts unifiés : phases commerciales (avant signature) + phases delivery.
 * Pour kind=client : not_started → to_follow_up → awaiting_response → won → active → completed
 * Pour kind=product/transverse : démarre directement à `active`.
 *
 * `won` est l'étape pivot (deal signé, delivery pas encore démarré).
 * `lost` est terminal côté commercial (aucune delivery).
 */
export const projectStatus = pgEnum("project_status", [
  // Phases commerciales (kind=client)
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
  // Phases delivery
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
]);

/**
 * Modèle de facturation :
 *  - none   : pas de facturation (produits internes, transverses)
 *  - fixed  : forfait — `budgetAmount` est le revenu total quel que soit le temps
 *  - hourly : régie / TJM — revenu = heures réalisées × `hourlyRate`
 */
export const projectBillingType = pgEnum("project_billing_type", ["none", "fixed", "hourly"]);

/**
 * Projets = unité de travail de Parade. Couvre l'intégralité du cycle :
 *  - kind=client     : mission Automato pour un client externe (entityId requis).
 *                       Passe par les phases commerciales avant won → delivery.
 *  - kind=product    : produit interne (Prosper, Plcmnt, Parade OS…). Démarre direct en active.
 *  - kind=transverse : initiative interne (admin, RH, marketing). Démarre direct en active.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    kind: projectKind("kind").notNull(),
    status: projectStatus("status").notNull().default("planning"),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    /** Contact principal côté client (pré-signature). */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    color: text("color"),
    icon: text("icon"),
    description: text("description"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    billingType: projectBillingType("billing_type").notNull().default("none"),
    /** Forfait €HT (utilisé si billingType=fixed). */
    budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }),
    /** Taux horaire facturé €HT (utilisé si billingType=hourly). */
    hourlyRate: numeric("hourly_rate", { precision: 8, scale: 2 }),
    // Champs commerciaux — pertinents avant won (kind=client uniquement).
    valueAmount: numeric("value_amount", { precision: 12, scale: 2 }),
    probability: integer("probability"),
    source: text("source"),
    firstContactDate: date("first_contact_date"),
    lastContactDate: date("last_contact_date"),
    followUpDate: date("follow_up_date"),
    expectedCloseDate: date("expected_close_date"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // Devis et jalons sont stockés dans la table `invoices` (cf. migration
    // 0043_invoices_unified). Pour récupérer le devis d'un projet :
    //   select * from invoices where project_id = ? and kind = 'quote' limit 1
    // Pour les jalons :
    //   select * from invoices where project_id = ? and kind = 'milestone'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    kindIdx: index("projects_kind_idx").on(table.kind),
    statusIdx: index("projects_status_idx").on(table.status),
    entityIdx: index("projects_entity_idx").on(table.entityId),
    contactIdx: index("projects_contact_idx").on(table.contactId),
    ownerIdx: index("projects_owner_idx").on(table.ownerId),
    followUpIdx: index("projects_follow_up_idx").on(table.followUpDate),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
