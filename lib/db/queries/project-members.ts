import "server-only";

import { contacts } from "@/db/schema/contacts";
import { projectContacts } from "@/db/schema/project-contacts";
import { projectMembers } from "@/db/schema/project-members";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";

export async function getProjectMembers(projectId: string) {
  const conn = await db();
  return conn
    .select({
      id: users.id,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.fullName));
}

export async function getProjectContacts(projectId: string) {
  const conn = await db();
  return conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(projectContacts)
    .innerJoin(contacts, eq(contacts.id, projectContacts.contactId))
    .where(eq(projectContacts.projectId, projectId))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName));
}
