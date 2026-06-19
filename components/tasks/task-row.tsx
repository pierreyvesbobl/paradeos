"use client";

import { TaskAssigneeEditor } from "@/app/(app)/taches/inline-editors/assignee-editor";
import { TaskDueDateEditor } from "@/app/(app)/taches/inline-editors/due-date-editor";
import { TaskPriorityEditor } from "@/app/(app)/taches/inline-editors/priority-editor";
import { TaskProjectEditor } from "@/app/(app)/taches/inline-editors/project-editor";
import { TaskRowActions } from "@/app/(app)/taches/inline-editors/row-actions";
import { AvatarStack } from "@/components/tasks/avatar-stack";
import { PriorityPill } from "@/components/tasks/priority-pill";
import { TaskCheckbox } from "@/components/tasks/task-checkbox";
import type {
  TaskContactOption,
  TaskProjectOption,
  TaskRowData,
  TaskUserOption,
} from "@/components/tasks/task-types";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type Props = {
  row: TaskRowData;
  selected: boolean;
  onSelect: (id: string, modifiers: { shift: boolean; meta: boolean }) => void;
  hideProjectColumn: boolean;
  userOptions: TaskUserOption[];
  contactOptions: TaskContactOption[];
  projectOptions: TaskProjectOption[];
};

function isOverdue(dueDate: Date | string | null): boolean {
  if (!dueDate) return false;
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

/**
 * Ligne de tâche dense (42px). Le clic sur la zone "neutre" (case + titre)
 * sélectionne la ligne ; les éditeurs inline interceptent le clic via
 * `e.stopPropagation()` ou via leur trigger natif (Popover, DateInput).
 */
export function TaskRow({
  row,
  selected,
  onSelect,
  hideProjectColumn,
  userOptions,
  contactOptions,
  projectOptions,
}: Props) {
  const router = useRouter();
  const done = row.status === "done";
  const overdue = !done && isOverdue(row.dueDate);

  function handleRowClick(e: React.MouseEvent) {
    // Si l'utilisateur a cliqué sur un contrôle interactif (badge, popover
    // trigger, lien, etc.), il aura déjà eu son comportement propre — on ne
    // sélectionne pas la ligne.
    const target = e.target as HTMLElement;
    if (target.closest("[data-row-noselect]")) return;
    onSelect(row.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
  }

  function handleRowDoubleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-row-noselect]")) return;
    router.push(`/taches/${row.id}`);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-row-noselect]")) return;
    if (target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      router.push(`/taches/${row.id}`);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      onSelect(row.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
    }
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: la liste est intentionnellement
      // en flexbox plutôt qu'en <table> (case 18px + hover-reveal + sélection
      // ne tiennent pas dans un <tr>). role="row" sans tabIndex provoque l'erreur
      // a11y ; on rend la ligne focusable et on câble Enter/Espace.
      role="row"
      tabIndex={0}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      onKeyDown={handleRowKeyDown}
      aria-selected={selected}
      className={cn(
        "group/row relative flex min-h-[42px] cursor-pointer select-none items-center border-ds-border border-b px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary-50" : "hover:bg-ds-hover/60",
      )}
      style={
        selected
          ? { boxShadow: "inset 0 0 0 1.5px var(--ds-primary-400)", borderRadius: 6 }
          : undefined
      }
    >
      <span data-row-noselect className="mr-3 flex">
        <TaskCheckbox id={row.id} done={done} />
      </span>

      <span
        title="Double-cliquer pour ouvrir"
        className={cn(
          "min-w-0 flex-1 truncate pr-3 text-ds-text text-sm",
          done && "text-ds-text-tertiary line-through",
        )}
      >
        {row.title}
      </span>

      <span
        data-row-noselect
        className="flex w-[60px] shrink-0 items-center justify-end gap-1 text-ds-text-tertiary opacity-0 transition-opacity group-hover/row:opacity-100"
      >
        <TaskRowActions id={row.id} title={row.title} />
      </span>

      {!hideProjectColumn ? (
        <span data-row-noselect className="ml-1 w-[140px] shrink-0 truncate pr-2">
          <TaskProjectEditor
            id={row.id}
            value={row.projectId ? { id: row.projectId, name: row.projectName ?? "" } : null}
            options={projectOptions}
          />
        </span>
      ) : null}

      <span data-row-noselect className="w-[108px] shrink-0">
        <TaskPriorityEditor id={row.id} value={row.priority} />
      </span>

      <span data-row-noselect className="w-[84px] shrink-0">
        <TaskAssigneeEditor
          id={row.id}
          value={row.assignees}
          options={userOptions}
          contactOptions={contactOptions}
        />
      </span>

      <span
        data-row-noselect
        className="w-[100px] shrink-0 text-[13px]"
        style={{
          color: overdue ? "var(--ds-tint-red-text)" : "var(--ds-text-tertiary)",
        }}
      >
        <TaskDueDateEditor id={row.id} value={row.dueDate} />
      </span>
    </div>
  );
}

// Re-export so callers can render priority pill / avatar stack outside a row
// without needing an extra import path.
export { AvatarStack, PriorityPill };
