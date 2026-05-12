import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { TaskForm } from "../../task-form";

type Params = Promise<{ id: string }>;

export default async function EditTaskPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();
  const [task] = await conn.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) notFound();

  const [projectList, userList] = await Promise.all([
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .orderBy(asc(users.fullName)),
  ]);

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
        users={userList}
        defaultValues={{
          id: task.id,
          title: task.title,
          description: task.description ?? "",
          status: task.status,
          priority: task.priority,
          projectId: task.projectId ?? "",
          assigneeId: task.assigneeId ?? "",
          dueDate: task.dueDate ?? "",
          startDate: task.startDate ?? "",
        }}
      />
    </div>
  );
}
