"use client";

import { patchTask } from "@/lib/actions/tasks";
import { DAY_LABELS, addDays, isoDate } from "@/lib/calendar";
import type { TaskPriority, TaskStatus } from "@/lib/schemas/tasks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
// `router` est seulement utilisé dans TaskBar — pas besoin dans GanttView lui-même.

const DAY_WIDTH = 36;
// 44px pour tenir le titre (text-sm, ~17.5px) + le projet (text-[10px],
// ~12.5px) + padding sans que les deux lignes se chevauchent.
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 56;
const ROW_LABEL_WIDTH = 260;
const VIEW_DAYS = 56;

/**
 * Palette stable pour colorer les bars de tâche par projet. Hash du
 * `project_id` → index dans la palette → couleur déterministe (pas de
 * scintillement entre rendus). Les tâches sans projet reçoivent un
 * gris neutre.
 */
const PROJECT_COLORS = [
  "rgb(96 165 250 / 0.75)", // blue-400
  "rgb(167 139 250 / 0.75)", // violet-400
  "rgb(244 114 182 / 0.75)", // pink-400
  "rgb(251 146 60 / 0.75)", // orange-400
  "rgb(250 204 21 / 0.75)", // yellow-400
  "rgb(74 222 128 / 0.75)", // green-400
  "rgb(45 212 191 / 0.75)", // teal-400
  "rgb(34 211 238 / 0.75)", // cyan-400
  "rgb(251 113 133 / 0.75)", // rose-400
  "rgb(132 204 22 / 0.75)", // lime-500
];
const NO_PROJECT_COLOR = "rgb(148 163 184 / 0.65)"; // slate-400

function projectColor(projectId: string | null, explicit: string | null): string {
  // 1. Couleur définie explicitement sur le projet (édit via fiche projet).
  if (explicit) {
    // Si c'est un hex sans alpha, on ajoute un peu de transparence pour
    // matcher la lecture des teintes auto.
    if (/^#[0-9a-fA-F]{6}$/.test(explicit)) return `${explicit}bf`; // ~75% opacity
    return explicit;
  }
  // 2. Fallback : palette stable dérivée du project_id.
  if (!projectId) return NO_PROJECT_COLOR;
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const palette = PROJECT_COLORS;
  const idx = ((hash % palette.length) + palette.length) % palette.length;
  return palette[idx] ?? NO_PROJECT_COLOR;
}

export type GanttTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string | null;
  projectName: string | null;
  /** Couleur explicite du projet (hex, ex. `#3b82f6`). Si null, on
   * tombe sur la palette hash-based. Édite-la sur la fiche projet. */
  projectColor: string | null;
  startDate: string | null;
  dueDate: string | null;
};

type DragState = {
  mode: "move" | "resize-start" | "resize-end";
  taskId: string;
  originStart: Date;
  originEnd: Date;
  pointerStartX: number;
  movedDays: number;
};

/** Modulateurs visuels selon le status, appliqués au-dessus de la
 * couleur projet (border-left + opacity globale + strikethrough done). */
const STATUS_BORDER: Record<TaskStatus, string> = {
  todo: "border-l-foreground/30",
  in_progress: "border-l-blue-500",
  blocked: "border-l-amber-500",
  done: "border-l-emerald-500",
  cancelled: "border-l-slate-400",
};

export function GanttView({
  tasks,
  viewStartIso,
}: {
  tasks: GanttTask[];
  viewStartIso: string;
}) {
  const viewStart = new Date(`${viewStartIso}T00:00:00`);
  const days = Array.from({ length: VIEW_DAYS }, (_, i) => addDays(viewStart, i));
  const todayIdx = daysBetween(viewStart, new Date());

  const [optimistic, setOptimistic] = useState(tasks);
  useEffect(() => setOptimistic(tasks), [tasks]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, startTransition] = useTransition();
  const gridRef = useRef<HTMLDivElement | null>(null);

  function startDrag(e: React.PointerEvent<HTMLElement>, task: GanttTask, mode: DragState["mode"]) {
    if (!task.startDate || !task.dueDate) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      mode,
      taskId: task.id,
      originStart: new Date(`${task.startDate}T00:00:00`),
      originEnd: new Date(`${task.dueDate}T00:00:00`),
      pointerStartX: e.clientX,
      movedDays: 0,
    });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const deltaPx = e.clientX - drag.pointerStartX;
    const deltaDays = Math.round(deltaPx / DAY_WIDTH);
    if (deltaDays === drag.movedDays) return;

    setDrag({ ...drag, movedDays: deltaDays });
    setOptimistic((prev) =>
      prev.map((t) => {
        if (t.id !== drag.taskId) return t;
        const ns = new Date(drag.originStart);
        const ne = new Date(drag.originEnd);
        if (drag.mode === "move") {
          ns.setDate(ns.getDate() + deltaDays);
          ne.setDate(ne.getDate() + deltaDays);
        } else if (drag.mode === "resize-start") {
          ns.setDate(ns.getDate() + deltaDays);
          if (ns.getTime() > ne.getTime()) ns.setTime(ne.getTime());
        } else if (drag.mode === "resize-end") {
          ne.setDate(ne.getDate() + deltaDays);
          if (ne.getTime() < ns.getTime()) ne.setTime(ns.getTime());
        }
        return { ...t, startDate: isoDate(ns), dueDate: isoDate(ne) };
      }),
    );
  }

  function onPointerUp() {
    if (!drag) return;
    const { taskId, mode, movedDays, originStart, originEnd } = drag;
    setDrag(null);
    if (movedDays === 0) return;

    const updated = optimistic.find((t) => t.id === taskId);
    if (!updated) return;

    startTransition(async () => {
      const payload: { id: string; startDate?: string; dueDate?: string } = { id: taskId };
      if (mode !== "resize-end") payload.startDate = updated.startDate ?? undefined;
      if (mode !== "resize-start") payload.dueDate = updated.dueDate ?? undefined;
      const res = await patchTask(payload);
      if (!res.ok) {
        toast.error(res.message);
        // Rollback
        setOptimistic((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, startDate: isoDate(originStart), dueDate: isoDate(originEnd) }
              : t,
          ),
        );
      }
    });
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-md border bg-muted/30 p-4 text-center text-muted-foreground text-sm">
        Aucune tâche planifiée dans cet intervalle.
      </p>
    );
  }

  const totalWidth = VIEW_DAYS * DAY_WIDTH;

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div
        ref={gridRef}
        className="relative grid"
        style={{
          gridTemplateColumns: `${ROW_LABEL_WIDTH}px ${totalWidth}px`,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {/* Header coin */}
        <div className="border-r border-b bg-muted/40" style={{ height: HEADER_HEIGHT }} />
        {/* Header timeline */}
        <div
          className="relative border-b bg-muted/40"
          style={{ height: HEADER_HEIGHT, width: totalWidth }}
        >
          {/* Bandeaux semaine */}
          {Array.from({ length: VIEW_DAYS / 7 }, (_, w) => {
            const monday = addDays(viewStart, w * 7);
            return (
              <div
                key={isoDate(monday)}
                className="absolute top-0 border-r px-1.5 py-1 text-[10px] text-muted-foreground"
                style={{
                  left: w * 7 * DAY_WIDTH,
                  width: 7 * DAY_WIDTH,
                  height: HEADER_HEIGHT / 2,
                }}
              >
                Sem. {weekNumber(monday)} · {String(monday.getDate()).padStart(2, "0")}/
                {String(monday.getMonth() + 1).padStart(2, "0")}
              </div>
            );
          })}
          {/* Jours */}
          {days.map((d, i) => {
            const isToday = i === todayIdx;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={isoDate(d)}
                className={`absolute flex flex-col items-center justify-center border-r text-[10px] ${
                  isWeekend ? "bg-muted/30" : ""
                } ${isToday ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`}
                style={{
                  left: i * DAY_WIDTH,
                  top: HEADER_HEIGHT / 2,
                  width: DAY_WIDTH,
                  height: HEADER_HEIGHT / 2,
                }}
              >
                <span>{DAY_LABELS[(d.getDay() + 6) % 7]?.slice(0, 1)}</span>
                <span className="tabular-nums">{d.getDate()}</span>
              </div>
            );
          })}
        </div>

        {/* Rows */}
        {optimistic.map((t) => {
          const start = t.startDate ? new Date(`${t.startDate}T00:00:00`) : null;
          const end = t.dueDate ? new Date(`${t.dueDate}T00:00:00`) : null;
          const startIdx = start ? daysBetween(viewStart, start) : null;
          const endIdx = end ? daysBetween(viewStart, end) : null;

          // Bar visible dans la fenêtre ?
          const visible =
            startIdx !== null && endIdx !== null && endIdx >= 0 && startIdx < VIEW_DAYS;

          return (
            <div key={t.id} className="contents">
              {/* Label colonne */}
              <Link
                href={`/taches/${t.id}`}
                className="flex flex-col justify-center border-r border-b px-2.5 py-1.5 hover:bg-muted/40"
                style={{ height: ROW_HEIGHT }}
              >
                <span className="truncate font-medium text-sm">{t.title}</span>
                {t.projectName ? (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {t.projectName}
                  </span>
                ) : null}
              </Link>

              {/* Timeline cellule */}
              <div className="relative border-b" style={{ height: ROW_HEIGHT, width: totalWidth }}>
                {/* Lignes weekend */}
                {days.map((d, i) =>
                  d.getDay() === 0 || d.getDay() === 6 ? (
                    <div
                      key={isoDate(d)}
                      className="absolute top-0 bottom-0 bg-muted/20"
                      style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                    />
                  ) : null,
                )}
                {/* Today line */}
                {todayIdx >= 0 && todayIdx < VIEW_DAYS ? (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/60"
                    style={{ left: todayIdx * DAY_WIDTH + DAY_WIDTH / 2 }}
                  />
                ) : null}

                {/* Bar de la tâche */}
                {visible && startIdx !== null && endIdx !== null ? (
                  <TaskBar
                    task={t}
                    startIdx={Math.max(0, startIdx)}
                    endIdx={Math.min(VIEW_DAYS - 1, endIdx)}
                    clippedLeft={startIdx < 0}
                    clippedRight={endIdx >= VIEW_DAYS}
                    isDragging={drag?.taskId === t.id}
                    onDragStart={(e, mode) => startDrag(e, t, mode)}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskBar({
  task,
  startIdx,
  endIdx,
  clippedLeft,
  clippedRight,
  isDragging,
  onDragStart,
}: {
  task: GanttTask;
  startIdx: number;
  endIdx: number;
  clippedLeft: boolean;
  clippedRight: boolean;
  isDragging: boolean;
  onDragStart: (e: React.PointerEvent<HTMLElement>, mode: DragState["mode"]) => void;
}) {
  const router = useRouter();
  const left = startIdx * DAY_WIDTH + 2;
  // +1 jour parce que la barre couvre du début au fin INCLUS.
  const width = (endIdx - startIdx + 1) * DAY_WIDTH - 4;
  /**
   * Position pointerdown pour détecter qu'un drag (move OU resize) a
   * eu lieu et supprimer le click qui suit. Sans ça, un drag court
   * (qq pixels) déclenche le click sur le `<button>` qui navigue vers
   * la fiche tâche — comportement non voulu.
   */
  const startXRef = useRef<number | null>(null);
  const CLICK_THRESHOLD_PX = 4;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        startXRef.current = e.clientX;
        onDragStart(e, "move");
      }}
      onClick={(e) => {
        if (
          startXRef.current !== null &&
          Math.abs(e.clientX - startXRef.current) > CLICK_THRESHOLD_PX
        ) {
          e.preventDefault();
          return;
        }
        router.push(`/taches/${task.id}`);
      }}
      className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border-l-4 text-left text-[11px] shadow-sm transition-shadow active:cursor-grabbing ${STATUS_BORDER[task.status]} ${
        task.status === "done" || task.status === "cancelled" ? "opacity-50" : ""
      } ${
        isDragging ? "opacity-90 shadow-lg ring-2 ring-foreground/30" : "hover:shadow-md"
      } ${clippedLeft ? "rounded-l-none" : ""} ${clippedRight ? "rounded-r-none" : ""}`}
      style={{ left, width, backgroundColor: projectColor(task.projectId, task.projectColor) }}
      title={`${task.title}${task.projectName ? ` · ${task.projectName}` : ""}`}
    >
      <span
        className={`block truncate px-2 py-1 leading-tight text-foreground/90 ${
          task.status === "done" ? "line-through" : ""
        }`}
      >
        {task.title}
      </span>
      {!clippedLeft ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: drag handle, mouse-only par design
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragStart(e, "resize-start");
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize bg-foreground/0 hover:bg-foreground/15"
        />
      ) : null}
      {!clippedRight ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: drag handle, mouse-only par design
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragStart(e, "resize-end");
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize bg-foreground/0 hover:bg-foreground/15"
        />
      ) : null}
    </button>
  );
}

// ---------- helpers ----------

function daysBetween(a: Date, b: Date): number {
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((b0 - a0) / 86_400_000);
}

function weekNumber(d: Date): number {
  // ISO week number
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604_800_000);
}
