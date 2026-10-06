import { eq, inArray } from "drizzle-orm";
import type { StackedAssignee } from "@/components/tasks/avatar-stack";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { taskAssignees } from "@/db/schema/task-assignees";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { type DashboardTask, DashboardTasksPanel } from "../dashboard-tasks";
import { getDoneTodayCount, getMyOpenTasks } from "./queries";
import { bucketFor, dueLabelFor, isoDaysFromNow, projectTint, todayIso } from "./shared";

export async function TasksSection() {
  const authUser = await requireUser();
  const conn = await db();

  const today = todayIso();
  const weekEnd = isoDaysFromNow(7);

  const [myOpenTasksRows, doneTodayCount] = await Promise.all([
    getMyOpenTasks(authUser.id),
    getDoneTodayCount(authUser.id),
  ]);

  // Dépend des ids de la première vague.
  const myTaskIds = myOpenTasksRows.map((t) => t.id);
  const taskAssigneesRows =
    myTaskIds.length > 0
      ? await conn
          .select({
            taskId: taskAssignees.taskId,
            kind: taskAssignees.kind,
            userId: taskAssignees.userId,
            userName: users.fullName,
            userAvatarUrl: users.avatarUrl,
            contactId: taskAssignees.contactId,
            contactFirstName: contacts.firstName,
            contactLastName: contacts.lastName,
            contactEntityName: entities.name,
          })
          .from(taskAssignees)
          .leftJoin(users, eq(taskAssignees.userId, users.id))
          .leftJoin(contacts, eq(taskAssignees.contactId, contacts.id))
          .leftJoin(entities, eq(contacts.entityId, entities.id))
          .where(inArray(taskAssignees.taskId, myTaskIds))
      : [];

  const taskAssigneeMap = new Map<string, StackedAssignee[]>();
  for (const r of taskAssigneesRows) {
    const list = taskAssigneeMap.get(r.taskId) ?? [];
    if (r.kind === "user" && r.userId) {
      list.push({
        kind: "user",
        id: r.userId,
        fullName: r.userName,
        avatarUrl: r.userAvatarUrl,
      });
    } else if (r.kind === "contact" && r.contactId) {
      list.push({
        kind: "contact",
        id: r.contactId,
        fullName: `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim(),
        entityName: r.contactEntityName ?? null,
      });
    }
    taskAssigneeMap.set(r.taskId, list);
  }

  const dashTasks: DashboardTask[] = myOpenTasksRows.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    bucket: bucketFor(t.dueDate, today, weekEnd),
    dueDate: t.dueDate,
    dueLabel: dueLabelFor(t.dueDate, today),
    projectId: t.projectId,
    projectName: t.projectName,
    projectTint: t.projectId
      ? projectTint({ id: t.projectId, color: t.projectColor ?? null })
      : "var(--ds-border-strong)",
    assignees: taskAssigneeMap.get(t.id) ?? [],
  }));

  return <DashboardTasksPanel tasks={dashTasks} doneCount={doneTodayCount} />;
}
