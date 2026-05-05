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
import { projects } from "./projects";
import { users } from "./users";

export const opportunityStatus = pgEnum("opportunity_status", [
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
]);

/**
 * Pipeline commercial Automato. Une opportunité = un deal en cours avec
 * un client/prospect. Quand elle passe en `won`, on peut la convertir
 * en `projects` via `convertOpportunityToProject` (cf. lib/actions).
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    status: opportunityStatus("status").notNull().default("not_started"),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    valueAmount: numeric("value_amount", { precision: 12, scale: 2 }),
    probability: integer("probability"),
    source: text("source"),
    firstContactDate: date("first_contact_date"),
    lastContactDate: date("last_contact_date"),
    followUpDate: date("follow_up_date"),
    expectedCloseDate: date("expected_close_date"),
    notes: text("notes"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    statusIdx: index("opportunities_status_idx").on(table.status),
    entityIdx: index("opportunities_entity_idx").on(table.entityId),
    contactIdx: index("opportunities_contact_idx").on(table.contactId),
    ownerIdx: index("opportunities_owner_idx").on(table.ownerId),
    followUpIdx: index("opportunities_follow_up_idx").on(table.followUpDate),
  }),
);

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
