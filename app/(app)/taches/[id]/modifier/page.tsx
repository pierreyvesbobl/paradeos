import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { fetchAssigneesForTasks } from "@/lib/db/queries/task-assignees";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { TaskForm } from "../../task-form";

import { formatPersonName } from "@/lib/format";
type Params = Promise<{ id: string }>;

export default async function EditTaskPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();
  const [task] = await conn.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) notFound();

  const [projectList, userList, contactList, assigneesByTask] = await Promise.all([
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
    fetchAssigneesForTasks(conn, [id]),
  ]);

  const assignees = assigneesByTask.get(id) ?? [];

  const contactOptions = contactList.map((c) => ({
    id: c.id,
    fullName: formatPersonName(c.firstName, c.lastName),
    entityName: c.entityName ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Tâches", href: "/taches" },
              { label: task.title, href: `/taches/${task.id}` },
              { label: "Modifier" },
            ]}
          />
        }
        title={`Modifier — ${task.title}`}
      />
      <TaskForm
        mode="edit"
        projects={projectList}
        userOptions={userList}
        contactOptions={contactOptions}
        defaultValues={{
          id: task.id,
          title: task.title,
          description: task.description ?? "",
          status: task.status,
          priority: task.priority,
          projectId: task.projectId ?? "",
          assignees,
          dueDate: task.dueDate ?? "",
          startDate: task.startDate ?? "",
        }}
      />
    </div>
  );
}
