import { sql } from "drizzle-orm";
import { date, index, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { users } from "./users";

export const projectKind = pgEnum("project_kind", ["client", "product", "transverse"]);
export const projectStatus = pgEnum("project_status", [
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
 * Projets = unité de travail de Parade.
 *  - kind=client     : mission Automato pour un client externe (entityId requis)
 *  - kind=product    : produit interne (Prosper, Plcmnt, Parade OS…)
 *  - kind=transverse : initiative interne (admin, RH, marketing groupe)
 *
 * Le rattachement à une opportunité se fait via `opportunities.projectId`
 * (FK posée côté opportunities pour éviter une dépendance circulaire ici).
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    kind: projectKind("kind").notNull(),
    status: projectStatus("status").notNull().default("planning"),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
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
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    kindIdx: index("projects_kind_idx").on(table.kind),
    statusIdx: index("projects_status_idx").on(table.status),
    entityIdx: index("projects_entity_idx").on(table.entityId),
    ownerIdx: index("projects_owner_idx").on(table.ownerId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
