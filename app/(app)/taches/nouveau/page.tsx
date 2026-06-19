import { PageHeader } from "@/components/page-header";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import type { TaskPriority, TaskStatus } from "@/lib/schemas/tasks";
import { asc, eq } from "drizzle-orm";
import { TaskForm } from "../task-form";

type SearchParams = Promise<{ projectId?: string; assigneeId?: string }>;

export default async function NewTaskPage({ searchParams }: { searchParams: SearchParams }) {
  const { projectId, assigneeId } = await searchParams;
  const conn = await db();

  const [projectList, userList, contactList] = await Promise.all([
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .orderBy(asc(users.fullName)),
    conn
      .select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        entityName: entities.name,
      })
      .from(contactsTable)
      .leftJoin(entities, eq(entities.id, contactsTable.entityId))
      .orderBy(asc(contactsTable.lastName), asc(contactsTable.firstName)),
  ]);

  const contactOptions = contactList.map((c) => ({
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`.trim(),
    entityName: c.entityName ?? null,
  }));

  // Pré-sélectionne l'assigné si passé en query param (compat ascendante
  // depuis les liens "Créer une tâche assignée à X").
  const preselectedAssignee = assigneeId ? userList.find((u) => u.id === assigneeId) : undefined;
  const initialAssignees = preselectedAssignee
    ? [
        {
          kind: "user" as const,
          id: preselectedAssignee.id,
          fullName: preselectedAssignee.fullName,
          avatarUrl: preselectedAssignee.avatarUrl,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Tâches" title="Nouvelle tâche" />
      <TaskForm
        mode="create"
        projects={projectList}
        userOptions={userList}
        contactOptions={contactOptions}
        defaultValues={{
          title: "",
          description: "",
          status: "todo" as TaskStatus,
          priority: "medium" as TaskPriority,
          projectId: projectId ?? "",
          assignees: initialAssignees,
          dueDate: "",
          startDate: "",
        }}
      />
    </div>
  );
}
