import { PageHeader } from "@/components/page-header";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import type { TaskPriority, TaskStatus } from "@/lib/schemas/tasks";
import { asc } from "drizzle-orm";
import { TaskForm } from "../task-form";

type SearchParams = Promise<{ projectId?: string; assigneeId?: string }>;

export default async function NewTaskPage({ searchParams }: { searchParams: SearchParams }) {
  const { projectId, assigneeId } = await searchParams;
  const conn = await db();

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
      <PageHeader eyebrow="Tâches" title="Nouvelle tâche" />
      <TaskForm
        mode="create"
        projects={projectList}
        users={userList}
        defaultValues={{
          title: "",
          description: "",
          status: "todo" as TaskStatus,
          priority: "medium" as TaskPriority,
          projectId: projectId ?? "",
          assigneeId: assigneeId ?? "",
          dueDate: "",
        }}
      />
    </div>
  );
}
