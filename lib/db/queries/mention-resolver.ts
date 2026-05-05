import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { asc } from "drizzle-orm";

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/**
 * Construit le resolver passé au composant Markdown : map slugs/prénoms
 * → href vers la fiche correspondante. Coût d'1 query par table — mais
 * tout est petit en volume (max quelques centaines de lignes), donc OK.
 */
export async function buildMarkdownResolver() {
  const conn = await db();
  const [userList, entityRows, contactRows, projectRows, oppRows, taskRows] = await Promise.all([
    conn
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .orderBy(asc(users.fullName)),
    conn.select({ id: entities.id, name: entities.name }).from(entities),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts),
    conn.select({ id: projects.id, name: projects.name }).from(projects),
    conn.select({ id: opportunities.id, title: opportunities.title }).from(opportunities),
    conn.select({ id: tasks.id, title: tasks.title }).from(tasks),
  ]);

  const usersResolver: Record<string, { id: string; fullName: string | null }> = {};
  for (const u of userList) {
    if (!u.fullName) continue;
    const trimmed = u.fullName.trim();
    if (!trimmed) continue;
    const firstName = trimmed.split(/\s+/)[0]?.toLowerCase();
    const compact = trimmed.replace(/\s+/g, "").toLowerCase();
    if (firstName && !usersResolver[firstName]) usersResolver[firstName] = u;
    if (compact && !usersResolver[compact]) usersResolver[compact] = u;
  }

  function asHrefMap<T extends { id: string }>(
    rows: T[],
    label: (r: T) => string,
    pathPrefix: string,
  ): Record<string, string> {
    const map: Record<string, string> = {};
    for (const row of rows) {
      const s = slug(label(row));
      if (s && !map[s]) map[s] = `${pathPrefix}/${row.id}`;
    }
    return map;
  }

  return {
    users: usersResolver,
    entities: asHrefMap(entityRows, (e) => e.name, "/entites"),
    contacts: asHrefMap(contactRows, (c) => `${c.firstName} ${c.lastName}`, "/contacts"),
    projects: asHrefMap(projectRows, (p) => p.name, "/projets"),
    opportunities: asHrefMap(oppRows, (o) => o.title, "/opportunites"),
    tasks: asHrefMap(taskRows, (t) => t.title, "/taches"),
  } as const;
}
