import type { TaskPriority, TaskStatus } from "@/lib/schemas/tasks";

export type TaskRowAssignee =
  | { kind: "user"; id: string; fullName: string | null; avatarUrl: string | null }
  | { kind: "contact"; id: string; fullName: string; entityName: string | null };

export type TaskRowData = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | string | null;
  projectId: string | null;
  projectName: string | null;
  assignees: TaskRowAssignee[];
};

export type TaskUserOption = { id: string; fullName: string | null; avatarUrl: string | null };
export type TaskContactOption = { id: string; fullName: string; entityName: string | null };
export type TaskProjectOption = { id: string; name: string };
