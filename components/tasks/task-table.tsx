"use client";

import { QuickAddTask } from "@/app/(app)/taches/quick-add-task";
import type { SortState } from "@/components/table/sortable-header";
import { FloatingActionBar } from "@/components/tasks/floating-action-bar";
import { TaskRow } from "@/components/tasks/task-row";
import type {
  TaskContactOption,
  TaskProjectOption,
  TaskRowData,
  TaskUserOption,
} from "@/components/tasks/task-types";
import { bulkDeleteTasks, bulkPatchTasks } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Map champ → href de tri. Sérialisée côté serveur (les fonctions ne
 * peuvent pas franchir la frontière server → client). Chaque entrée est
 * le href à pointer pour basculer l'état du tri sur ce champ (asc → desc
 * → none).
 */
export type SortHrefs = Partial<Record<string, string>>;

type Props = {
  rows: TaskRowData[];
  userOptions: TaskUserOption[];
  contactOptions: TaskContactOption[];
  projectOptions: TaskProjectOption[];
  /** Si true, la colonne "Projet" et son tri ne sont pas rendus. */
  hideProjectColumn?: boolean;
  /** Pré-remplit l'ajout rapide avec un projectId (fiche projet). */
  defaultProjectId?: string;
  /** État du tri URL — uniquement utilisé si `sortHrefs` est fourni. */
  sort?: SortState;
  /** Map champ → href pour faire basculer le tri. Si absent, la table rend
   *  des en-têtes statiques (page projet où le tri n'est pas câblé). */
  sortHrefs?: SortHrefs;
};

function isDoneStatus(s: TaskRowData["status"]): boolean {
  return s === "done" || s === "cancelled";
}

/**
 * Primitive partagée entre `/taches` et l'onglet Tâches d'un projet.
 * Densité 42px par ligne, colonnes alignées sans encadré, sélection au clic
 * (Maj+clic = plage), case unique pour terminer, "Terminées" repliable,
 * ajout rapide en ligne et barre flottante d'actions groupées.
 */
export function TaskTable({
  rows,
  userOptions,
  contactOptions,
  projectOptions,
  hideProjectColumn = false,
  defaultProjectId,
  sort,
  sortHrefs,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const { open, done } = useMemo(() => {
    const open: TaskRowData[] = [];
    const done: TaskRowData[] = [];
    for (const r of rows) {
      if (isDoneStatus(r.status)) done.push(r);
      else open.push(r);
    }
    return { open, done };
  }, [rows]);

  const visibleRows = useMemo(() => (showDone ? [...open, ...done] : open), [open, done, showDone]);

  const handleSelect = useCallback(
    (id: string, modifiers: { shift: boolean; meta: boolean }) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (modifiers.shift && lastSelectedId && lastSelectedId !== id) {
          const order = visibleRows.map((r) => r.id);
          const a = order.indexOf(lastSelectedId);
          const b = order.indexOf(id);
          if (a >= 0 && b >= 0) {
            const [from, to] = a < b ? [a, b] : [b, a];
            for (let i = from; i <= to; i++) {
              const rowId = order[i];
              if (rowId) next.add(rowId);
            }
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelectedId(id);
    },
    [lastSelectedId, visibleRows],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setLastSelectedId(null);
  }, []);

  function runBulk(action: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        toast.error(res.message ?? "Échec de l'action.");
        return;
      }
      clearSelection();
      router.refresh();
    });
  }

  const ids = useMemo(() => Array.from(selected), [selected]);

  function handleBulkComplete() {
    if (ids.length === 0) return;
    runBulk(() => bulkPatchTasks({ ids, patch: { status: "done" } }));
  }

  function handleBulkDelete() {
    if (ids.length === 0) return;
    runBulk(() => bulkDeleteTasks({ ids }));
  }

  const openLabel = `${open.length} ouverte${open.length > 1 ? "s" : ""}`;
  const doneLabel =
    done.length === 0 ? "" : ` · ${done.length} terminée${done.length > 1 ? "s" : ""}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3 pt-1">
        <span className="font-medium text-ds-text text-sm">Tâches</span>
        <span className="text-ds-text-tertiary text-sm">
          {openLabel}
          {doneLabel}
        </span>
      </div>

      <ColumnHeader hideProjectColumn={hideProjectColumn} sort={sort} sortHrefs={sortHrefs} />

      <div className="flex flex-col">
        {/* Ajout rapide en tête — fond primary-50 + accent bleu inset */}
        <QuickAddTask
          projectId={defaultProjectId}
          userOptions={userOptions}
          contactOptions={contactOptions}
          projectOptions={projectOptions}
          hideProjectColumn={hideProjectColumn}
        />

        {visibleRows.length === 0 ? (
          <div className="border-ds-border border-b py-3 text-center text-ds-text-tertiary text-sm">
            Aucune tâche.
          </div>
        ) : (
          visibleRows.map((row) => (
            <TaskRow
              key={row.id}
              row={row}
              selected={selected.has(row.id)}
              onSelect={handleSelect}
              hideProjectColumn={hideProjectColumn}
              userOptions={userOptions}
              contactOptions={contactOptions}
              projectOptions={projectOptions}
            />
          ))
        )}
      </div>

      {done.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="flex items-center gap-2 self-start px-2 py-1 text-ds-text-muted text-sm transition-colors hover:text-ds-text"
        >
          {showDone ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <span className="font-medium">Terminées</span>
          <span
            className={cn(
              "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-medium text-[11px]",
              "bg-ds-hover text-ds-text-muted",
            )}
          >
            {done.length}
          </span>
          {!showDone ? (
            <span className="text-ds-text-tertiary text-xs">— cliquer pour afficher</span>
          ) : null}
        </button>
      ) : null}

      <FloatingActionBar
        count={selected.size}
        pending={pending}
        onClear={clearSelection}
        onComplete={handleBulkComplete}
        onDelete={handleBulkDelete}
      />
    </section>
  );
}

function ColumnHeader({
  hideProjectColumn,
  sort,
  sortHrefs,
}: {
  hideProjectColumn: boolean;
  sort?: SortState;
  sortHrefs?: SortHrefs;
}) {
  return (
    <div className="flex items-center border-ds-border border-b px-2 pb-2">
      <span className="mr-3 w-[18px] shrink-0" />
      <span className="flex-1">
        <HeaderLabel label="Tâche" field="title" sort={sort} sortHrefs={sortHrefs} />
      </span>
      <span className="w-[60px] shrink-0" />
      {!hideProjectColumn ? (
        <span className="ml-1 w-[140px] shrink-0 pr-2">
          <HeaderLabel label="Projet" field="project" sort={sort} sortHrefs={sortHrefs} />
        </span>
      ) : null}
      <span className="w-[108px] shrink-0">
        <HeaderLabel label="Priorité" field="priority" sort={sort} sortHrefs={sortHrefs} />
      </span>
      <span className="w-[84px] shrink-0">
        <HeaderLabel label="Assigné" field="assignee" sort={sort} sortHrefs={sortHrefs} />
      </span>
      <span className="w-[100px] shrink-0">
        <HeaderLabel label="Échéance" field="dueDate" sort={sort} sortHrefs={sortHrefs} />
      </span>
    </div>
  );
}

function HeaderLabel({
  label,
  field,
  sort,
  sortHrefs,
}: {
  label: string;
  field: string;
  sort?: SortState;
  sortHrefs?: SortHrefs;
}) {
  const labelClass =
    "inline-flex items-center gap-1 font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-wider";
  const href = sortHrefs?.[field];
  if (!href) return <span className={labelClass}>{label}</span>;

  const isActive = sort?.field === field;
  const icon = !isActive ? (
    <ArrowUpDown className="size-3 opacity-50" />
  ) : sort?.dir === "asc" ? (
    <ArrowUp className="size-3" />
  ) : (
    <ArrowDown className="size-3" />
  );
  return (
    <Link href={href} className={cn(labelClass, "hover:text-ds-text", isActive && "text-ds-text")}>
      <span>{label}</span>
      {icon}
    </Link>
  );
}
