"use client";

import { AvatarStack, type StackedAssignee } from "@/components/tasks/avatar-stack";
import { PriorityPill } from "@/components/tasks/priority-pill";
import { TaskCheckbox } from "@/components/tasks/task-checkbox";
import { DemoBlur, ProjectName } from "@/lib/demo/components";
import type { TaskPriority } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";
import { CalendarDots, ListChecks, Plus, SunHorizon, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

export type DashboardTask = {
  id: string;
  title: string;
  priority: TaskPriority;
  bucket: "overdue" | "today" | "week" | "later";
  dueDate: string | null;
  dueLabel: string;
  projectId: string | null;
  projectName: string | null;
  projectTint: string;
  assignees: StackedAssignee[];
};

type FilterKey = "all" | "overdue" | "today" | "week";

const GROUP_DEF: {
  key: DashboardTask["bucket"];
  label: string;
  icon: typeof WarningCircle;
  accent: string;
}[] = [
  { key: "overdue", label: "En retard", icon: WarningCircle, accent: "text-tint-red-text" },
  { key: "today", label: "Aujourd'hui", icon: SunHorizon, accent: "text-primary-700" },
  { key: "week", label: "Cette semaine", icon: CalendarDots, accent: "text-ds-text-muted" },
  {
    key: "later",
    label: "Plus tard / sans date",
    icon: CalendarDots,
    accent: "text-ds-text-muted",
  },
];

export function DashboardTasksPanel({
  tasks,
  doneCount,
}: {
  tasks: DashboardTask[];
  doneCount: number;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const matches = (t: DashboardTask) => filter === "all" || t.bucket === filter;
  const visible = tasks.filter(matches);

  const counts = {
    all: tasks.length,
    overdue: tasks.filter((t) => t.bucket === "overdue").length,
    today: tasks.filter((t) => t.bucket === "today").length,
    week: tasks.filter((t) => t.bucket === "week").length,
  };

  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "Toutes", count: counts.all },
    { key: "overdue", label: "En retard", count: counts.overdue },
    { key: "today", label: "Aujourd'hui", count: counts.today },
    { key: "week", label: "Cette semaine", count: counts.week },
  ];

  const groups = GROUP_DEF.map((g) => ({
    ...g,
    items: visible.filter((t) => t.bucket === g.key),
  })).filter((g) => g.items.length > 0);

  const allDone = groups.length === 0;

  return (
    <div className="overflow-hidden rounded-xl border border-ds-border bg-ds-app">
      <div className="border-ds-border border-b px-5 pt-4 pb-3">
        <div className="mb-3 flex items-center gap-2.5">
          <ListChecks weight="duotone" className="size-5 text-primary-500" />
          <h2 className="font-semibold text-[17px] text-ds-text">Mes tâches</h2>
          <span className="text-ds-text-tertiary text-sm">tous projets confondus</span>
          <span className="flex-1" />
          <span className="text-ds-text-tertiary text-sm">{counts.all} ouvertes</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                type="button"
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-sm transition-colors",
                  active
                    ? "bg-primary-50 text-primary-900"
                    : "text-ds-text-muted hover:bg-ds-hover",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 font-semibold text-[11px]",
                    active ? "bg-primary-100 text-primary-900" : "bg-ds-hover text-ds-text-muted",
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Link
        href="/taches/nouveau"
        className="qadd mx-4 mt-3 flex items-center gap-2.5 rounded-lg border border-ds-border bg-ds-surface px-3 py-2 transition-colors hover:border-primary-400"
      >
        <Plus weight="bold" className="size-3.5 text-primary-500" />
        <span className="flex-1 text-ds-text-tertiary text-sm">Ajouter une tâche…</span>
        <span className="text-ds-text-tertiary text-xs">Entrée pour créer</span>
      </Link>

      <div className="px-2 pt-1 pb-2">
        {allDone ? (
          <div className="px-2 py-10 text-center">
            <div className="font-medium text-ds-text">Tout est à jour ici.</div>
            <div className="mt-1 text-ds-text-tertiary text-sm">Aucune tâche dans cette vue.</div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="mt-1.5">
              <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                <g.icon weight="duotone" className={cn("size-4", g.accent)} />
                <span className={cn("font-medium text-sm", g.accent)}>{g.label}</span>
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ds-hover px-1.5 font-semibold text-[11px] text-ds-text-muted">
                  {g.items.length}
                </span>
              </div>
              <ul>
                {g.items.map((t) => (
                  <TaskListRow key={t.id} task={t} />
                ))}
              </ul>
            </div>
          ))
        )}

        <div className="mt-2 flex items-center gap-2 border-ds-border border-t px-2.5 pt-2.5">
          <span className="text-ds-text-muted text-sm">Terminées</span>
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ds-hover px-1.5 font-semibold text-[11px] text-ds-text-muted">
            {doneCount}
          </span>
        </div>
      </div>
    </div>
  );
}

function TaskListRow({ task }: { task: DashboardTask }) {
  const dateCls =
    task.bucket === "overdue"
      ? "text-tint-red-text"
      : task.bucket === "today"
        ? "text-primary-700"
        : "text-ds-text-tertiary";
  return (
    <li className="group/row flex items-center rounded-md px-2.5 transition-colors hover:bg-ds-hover">
      <span className="mr-3">
        <TaskCheckbox id={task.id} done={false} />
      </span>
      <Link href={`/taches/${task.id}`} className="flex min-w-0 flex-1 flex-col py-2.5">
        <span className="truncate text-ds-text text-sm">
          <DemoBlur>{task.title}</DemoBlur>
        </span>
        {task.projectName && task.projectId ? (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-ds-text-tertiary text-xs">
            <span
              className="size-[7px] flex-none rounded-full"
              style={{ background: task.projectTint }}
            />
            <ProjectName project={{ id: task.projectId, name: task.projectName }} />
          </span>
        ) : (
          <span className="mt-0.5 text-ds-text-tertiary text-xs">— sans projet</span>
        )}
      </Link>
      <span className="w-[100px] flex-none">
        <PriorityPill value={task.priority} />
      </span>
      <span className="w-[68px] flex-none">
        <AvatarStack assignees={task.assignees} max={2} />
      </span>
      <span className={cn("w-[64px] flex-none text-right font-medium text-xs", dateCls)}>
        {task.dueLabel}
      </span>
    </li>
  );
}
