"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { asc, ilike, or } from "drizzle-orm";

export type SearchResults = {
  opportunities: { id: string; title: string }[];
  contacts: { id: string; firstName: string; lastName: string }[];
  projects: { id: string; name: string }[];
  entities: { id: string; name: string }[];
  tasks: { id: string; title: string }[];
};

const EMPTY: SearchResults = {
  opportunities: [],
  contacts: [],
  projects: [],
  entities: [],
  tasks: [],
};

const LIMIT = 5;

export async function globalSearch(query: string): Promise<SearchResults> {
  await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return EMPTY;

  const conn = await db();
  const pattern = `%${trimmed}%`;

  const [opps, cnts, prjs, ents, tks] = await Promise.all([
    conn
      .select({ id: opportunities.id, title: opportunities.title })
      .from(opportunities)
      .where(ilike(opportunities.title, pattern))
      .orderBy(asc(opportunities.title))
      .limit(LIMIT),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(
        or(
          ilike(contacts.firstName, pattern),
          ilike(contacts.lastName, pattern),
          ilike(contacts.email, pattern),
        ),
      )
      .orderBy(asc(contacts.lastName))
      .limit(LIMIT),
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(ilike(projects.name, pattern))
      .orderBy(asc(projects.name))
      .limit(LIMIT),
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(ilike(entities.name, pattern))
      .orderBy(asc(entities.name))
      .limit(LIMIT),
    conn
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(ilike(tasks.title, pattern))
      .orderBy(asc(tasks.title))
      .limit(LIMIT),
  ]);

  return {
    opportunities: opps,
    contacts: cnts,
    projects: prjs,
    entities: ents,
    tasks: tks,
  };
}
