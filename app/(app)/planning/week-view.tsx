"use client";

import { Button } from "@/components/ui/button";
import { moveTimeEntry } from "@/lib/actions/time-entries";
import { DAY_LABELS, addDays, formatWeekRange, startOfIsoWeek } from "@/lib/calendar";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { TimeEntryDialog } from "./time-entry-dialog";

const HOUR_HEIGHT = 48; // px par heure
const HOURS_START = 7; // 07:00
const HOURS_END = 21; // 21:00
const SNAP_MINUTES = 15;
const HOURS_COL_WIDTH = 60;
const HOURS_OF_DAY = Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i);
const CLICK_THRESHOLD_PX = 4;

type EntrySerialized = {
  id: string;
  kind: "planned" | "actual";
  startAt: string;
  endAt: string;
  title: string | null;
  description: string | null;
  taskId: string | null;
  projectId: string | null;
  contactId: string | null;
  color: string | null;
};

type Props = {
  weekStartIso: string;
  entries: EntrySerialized[];
  tasks: { id: string; title: string }[];
  projects: { id: string; name: string }[];
  contacts: { id: string; label: string }[];
};

type EntryDrag = {
  mode: "move" | "resize";
  id: string;
  originStart: Date;
  originEnd: Date;
  pointerStartY: number;
  pointerStartDayIndex: number;
  moved: boolean;
};

type CreateDrag = {
  dayIndex: number;
  day: Date;
  pointerStartY: number;
  /** minutes depuis HOURS_START au point d'origine, snappées. */
  originMinutes: number;
  /** minutes depuis HOURS_START au point courant, snappées. */
  currentMinutes: number;
};

export function WeekView({ weekStartIso, entries, tasks, projects, contacts }: Props) {
  const weekStart = startOfIsoWeek(new Date(`${weekStartIso}T00:00:00`));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [optimistic, setOptimistic] = useState(entries);

  // Resync l'état local quand le serveur renvoie de nouvelles entries
  // (création/mutation via dialog → router.refresh()). Sans ça, useState
  // garde sa valeur initiale et l'utilisateur ne voit rien jusqu'au reload.
  useEffect(() => {
    setOptimistic(entries);
  }, [entries]);
  const [entryDrag, setEntryDrag] = useState<EntryDrag | null>(null);
  const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
  const [, startTransition] = useTransition();
  const gridRef = useRef<HTMLDivElement | null>(null);

  const [dialogState, setDialogState] = useState<
    | { mode: "create"; defaults: { startAt: string; endAt: string } }
    | { mode: "edit"; entry: EntrySerialized }
    | null
  >(null);

  function onEntryClick(entry: EntrySerialized) {
    setDialogState({ mode: "edit", entry });
  }

  function startEntryDrag(
    e: React.PointerEvent<HTMLElement>,
    entry: EntrySerialized,
    mode: "move" | "resize",
  ) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const start = new Date(entry.startAt);
    const end = new Date(entry.endAt);
    const dayIndex = (start.getDay() + 6) % 7;
    setEntryDrag({
      mode,
      id: entry.id,
      originStart: start,
      originEnd: end,
      pointerStartY: e.clientY,
      pointerStartDayIndex: dayIndex,
      moved: false,
    });
  }

  function startCreateDrag(e: React.PointerEvent<HTMLDivElement>, day: Date, dayIndex: number) {
    // Le pointer down sur une entrée existante a déjà fait stopPropagation.
    // Ici on n'attrape donc que les zones libres.
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const minutes = snap(yToMinutes(e.clientY, e.currentTarget));
    setCreateDrag({
      dayIndex,
      day,
      pointerStartY: e.clientY,
      originMinutes: minutes,
      currentMinutes: minutes,
    });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (entryDrag) {
      handleEntryDragMove(e);
      return;
    }
    if (createDrag && gridRef.current) {
      const col = getDayColumn(gridRef.current, createDrag.dayIndex);
      if (!col) return;
      const minutes = clamp(snap(yToMinutes(e.clientY, col)), 0, (HOURS_END - HOURS_START) * 60);
      if (minutes !== createDrag.currentMinutes) {
        setCreateDrag({ ...createDrag, currentMinutes: minutes });
      }
    }
  }

  function handleEntryDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!entryDrag || !gridRef.current) return;
    const deltaY = e.clientY - entryDrag.pointerStartY;
    const rawMinutes = (deltaY / HOUR_HEIGHT) * 60;
    const snappedMinutes = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;

    if (entryDrag.mode === "resize") {
      const newEnd = new Date(entryDrag.originEnd.getTime() + snappedMinutes * 60_000);
      if (newEnd.getTime() - entryDrag.originStart.getTime() < SNAP_MINUTES * 60_000) return;
      setOptimistic((prev) =>
        prev.map((it) => (it.id === entryDrag.id ? { ...it, endAt: newEnd.toISOString() } : it)),
      );
      if (snappedMinutes !== 0 && !entryDrag.moved) setEntryDrag({ ...entryDrag, moved: true });
      return;
    }

    const targetDayIndex = computeDayIndex(e.clientX, gridRef.current);
    const newDayIndex = targetDayIndex ?? entryDrag.pointerStartDayIndex;
    const dayDelta = newDayIndex - entryDrag.pointerStartDayIndex;

    const newStart = shiftDate(entryDrag.originStart, dayDelta, snappedMinutes);
    const duration = entryDrag.originEnd.getTime() - entryDrag.originStart.getTime();
    const newEnd = new Date(newStart.getTime() + duration);

    setOptimistic((prev) =>
      prev.map((it) =>
        it.id === entryDrag.id
          ? { ...it, startAt: newStart.toISOString(), endAt: newEnd.toISOString() }
          : it,
      ),
    );
    if ((dayDelta !== 0 || snappedMinutes !== 0) && !entryDrag.moved) {
      setEntryDrag({ ...entryDrag, moved: true });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (entryDrag) {
      finalizeEntryDrag();
      return;
    }
    if (createDrag) {
      finalizeCreateDrag(e);
    }
  }

  function finalizeEntryDrag() {
    if (!entryDrag) return;
    const { id, moved, originStart, originEnd } = entryDrag;
    setEntryDrag(null);
    if (!moved) return;

    const current = optimistic.find((it) => it.id === id);
    if (!current) return;

    startTransition(async () => {
      const result = await moveTimeEntry({
        id,
        startAt: current.startAt,
        endAt: current.endAt,
      });
      if (!result.ok) {
        toast.error(result.message);
        setOptimistic((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, startAt: originStart.toISOString(), endAt: originEnd.toISOString() }
              : it,
          ),
        );
      }
    });
  }

  function finalizeCreateDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!createDrag) return;
    const { day, originMinutes, currentMinutes, pointerStartY } = createDrag;
    setCreateDrag(null);

    const moved = Math.abs(e.clientY - pointerStartY) > CLICK_THRESHOLD_PX;

    let startMinutes: number;
    let endMinutes: number;

    if (!moved) {
      // Click simple → créneau d'1h aligné sur l'heure cliquée.
      const baseHour = Math.floor(originMinutes / 60);
      startMinutes = baseHour * 60;
      endMinutes = startMinutes + 60;
    } else {
      startMinutes = Math.min(originMinutes, currentMinutes);
      endMinutes = Math.max(originMinutes, currentMinutes);
      // Min 15 min.
      if (endMinutes - startMinutes < SNAP_MINUTES) endMinutes = startMinutes + SNAP_MINUTES;
    }

    const start = new Date(day);
    start.setHours(HOURS_START, 0, 0, 0);
    start.setMinutes(start.getMinutes() + startMinutes);

    const end = new Date(day);
    end.setHours(HOURS_START, 0, 0, 0);
    end.setMinutes(end.getMinutes() + endMinutes);

    setDialogState({
      mode: "create",
      defaults: { startAt: localInput(start), endAt: localInput(end) },
    });
  }

  return (
    <>
      <p className="text-muted-foreground text-sm">{formatWeekRange(weekStart)}</p>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div
          ref={gridRef}
          className="grid select-none"
          style={{ gridTemplateColumns: `${HOURS_COL_WIDTH}px repeat(7, minmax(140px, 1fr))` }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            setEntryDrag(null);
            setCreateDrag(null);
          }}
        >
          <div className="border-r border-b bg-muted/30" />
          {days.map((d, i) => {
            const today = isSameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={`border-r border-b px-2 py-2 text-xs ${today ? "bg-primary/5" : "bg-muted/30"}`}
              >
                <p className="font-medium">{DAY_LABELS[i]}</p>
                <p
                  className={`text-muted-foreground ${today ? "font-medium text-foreground" : ""}`}
                >
                  {d.getDate()}/{String(d.getMonth() + 1).padStart(2, "0")}
                </p>
              </div>
            );
          })}

          {/* Colonne heures */}
          <div
            className="border-r bg-muted/30"
            style={{ height: HOUR_HEIGHT * (HOURS_END - HOURS_START) }}
          >
            {HOURS_OF_DAY.map((hour) => (
              <div
                key={hour}
                className="border-b pr-1 text-right text-[10px] text-muted-foreground"
                style={{ height: HOUR_HEIGHT }}
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              dayIndex={dayIndex}
              entries={optimistic}
              entryDragId={entryDrag?.id ?? null}
              createDrag={createDrag?.dayIndex === dayIndex ? createDrag : null}
              onEntryClick={onEntryClick}
              startEntryDrag={startEntryDrag}
              startCreateDrag={startCreateDrag}
            />
          ))}
        </div>
      </div>

      <Button onClick={() => setDialogState({ mode: "create", defaults: defaultRange() })}>
        Nouveau créneau
      </Button>

      {dialogState ? (
        <TimeEntryDialog
          open
          onClose={() => setDialogState(null)}
          mode={dialogState.mode}
          tasks={tasks}
          projects={projects}
          contacts={contacts}
          defaults={
            dialogState.mode === "create"
              ? {
                  kind: "planned",
                  startAt: dialogState.defaults.startAt,
                  endAt: dialogState.defaults.endAt,
                  title: "",
                  description: "",
                  taskId: "",
                  projectId: "",
                  contactId: "",
                }
              : {
                  id: dialogState.entry.id,
                  kind: dialogState.entry.kind,
                  startAt: localInput(new Date(dialogState.entry.startAt)),
                  endAt: localInput(new Date(dialogState.entry.endAt)),
                  title: dialogState.entry.title ?? "",
                  description: dialogState.entry.description ?? "",
                  taskId: dialogState.entry.taskId ?? "",
                  projectId: dialogState.entry.projectId ?? "",
                  contactId: dialogState.entry.contactId ?? "",
                }
          }
        />
      ) : null}
    </>
  );
}

function DayColumn({
  day,
  dayIndex,
  entries,
  entryDragId,
  createDrag,
  onEntryClick,
  startEntryDrag,
  startCreateDrag,
}: {
  day: Date;
  dayIndex: number;
  entries: EntrySerialized[];
  entryDragId: string | null;
  createDrag: CreateDrag | null;
  onEntryClick: (entry: EntrySerialized) => void;
  startEntryDrag: (
    e: React.PointerEvent<HTMLElement>,
    entry: EntrySerialized,
    mode: "move" | "resize",
  ) => void;
  startCreateDrag: (e: React.PointerEvent<HTMLDivElement>, day: Date, dayIndex: number) => void;
}) {
  const dayEntries = entries.filter((e) => isSameDay(new Date(e.startAt), day));

  return (
    <div
      className="relative border-r"
      style={{ height: HOUR_HEIGHT * (HOURS_END - HOURS_START) }}
      onPointerDown={(e) => {
        // Filtre les boutons gauche uniquement.
        if (e.button !== 0) return;
        startCreateDrag(e, day, dayIndex);
      }}
    >
      {HOURS_OF_DAY.map((hour, idx) => (
        <div
          key={hour}
          className="absolute right-0 left-0 border-b"
          style={{ top: idx * HOUR_HEIGHT, height: HOUR_HEIGHT, pointerEvents: "none" }}
        />
      ))}

      {/* Ghost de création */}
      {createDrag ? (
        <div
          className="pointer-events-none absolute right-1 left-1 rounded border-2 border-primary/60 border-dashed bg-primary/15"
          style={{
            top: (Math.min(createDrag.originMinutes, createDrag.currentMinutes) / 60) * HOUR_HEIGHT,
            height:
              Math.max(
                SNAP_MINUTES / 60,
                Math.abs(createDrag.currentMinutes - createDrag.originMinutes) / 60,
              ) * HOUR_HEIGHT,
          }}
        >
          <p className="px-1.5 py-1 font-medium text-[10px] text-primary">
            {formatMinutesAfter(day, Math.min(createDrag.originMinutes, createDrag.currentMinutes))}
            {" – "}
            {formatMinutesAfter(day, Math.max(createDrag.originMinutes, createDrag.currentMinutes))}
          </p>
        </div>
      ) : null}

      {(() => {
        const layout = layoutDayEntries(dayEntries);
        return dayEntries.map((e) => {
          const start = new Date(e.startAt);
          const end = new Date(e.endAt);
          const startMinutes = (start.getHours() - HOURS_START) * 60 + start.getMinutes();
          const durationMinutes = Math.max(
            15,
            Math.round((end.getTime() - start.getTime()) / 60_000),
          );
          const top = (startMinutes / 60) * HOUR_HEIGHT;
          const height = (durationMinutes / 60) * HOUR_HEIGHT - 2;
          const isPlanned = e.kind === "planned";
          const bg = e.color ?? (isPlanned ? "rgb(79 70 229 / 0.12)" : "rgb(34 197 94 / 0.16)");
          const border = isPlanned ? "border-primary/40" : "border-emerald-500/40";
          const isDragging = entryDragId === e.id;

          const slot = layout.get(e.id) ?? { lane: 0, lanes: 1 };
          const gutter = 2; // px entre colonnes
          const widthPct = 100 / slot.lanes;
          const leftPct = slot.lane * widthPct;

          return (
            <div
              key={e.id}
              className={`absolute rounded border ${border} text-left text-[11px] leading-tight shadow-sm ${
                isDragging ? "z-10 opacity-90 shadow-lg ring-2 ring-primary/50" : ""
              }`}
              style={{
                top,
                height,
                backgroundColor: bg,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - ${gutter + 2}px)`,
              }}
            >
              <button
                type="button"
                className="block h-full w-full cursor-grab overflow-hidden px-1.5 py-1 text-left active:cursor-grabbing"
                onPointerDown={(ev) => startEntryDrag(ev, e, "move")}
                onClick={(ev) => {
                  if (isDragging) {
                    ev.preventDefault();
                    return;
                  }
                  onEntryClick(e);
                }}
              >
                <p className="truncate font-medium">{e.title ?? "Sans titre"}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatHm(start)}–{formatHm(end)}
                </p>
              </button>
              <div
                className="absolute right-0 bottom-0 left-0 h-2 cursor-ns-resize bg-foreground/0 hover:bg-foreground/10"
                onPointerDown={(ev) => startEntryDrag(ev, e, "resize")}
                role="separator"
                tabIndex={0}
                aria-label="Redimensionner"
              />
            </div>
          );
        });
      })()}
    </div>
  );
}

/**
 * Calcule, pour chaque entrée du jour, sa "lane" (colonne) et le nombre
 * total de lanes dans son cluster d'overlap. Les entrées qui se chevauchent
 * sont placées côte à côte ; les autres prennent toute la largeur.
 *
 * Algo classique :
 *  1. Tri par startAt croissant (puis durée décroissante en cas d'égalité).
 *  2. On maintient un tableau `columnsEnd` (fin de la dernière entrée
 *     placée dans chaque lane). On range chaque entrée dans la première
 *     lane libre (où `end <= start` de l'entrée courante).
 *  3. Quand toutes les lanes courantes se terminent avant la prochaine
 *     entrée, on "flush" le cluster : toutes les entrées du cluster
 *     reçoivent comme `lanes` la taille max atteinte par `columnsEnd`.
 */
function layoutDayEntries(
  entries: EntrySerialized[],
): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  if (entries.length === 0) return out;

  const sorted = [...entries].sort((a, b) => {
    const aStart = new Date(a.startAt).getTime();
    const bStart = new Date(b.startAt).getTime();
    if (aStart !== bStart) return aStart - bStart;
    return new Date(b.endAt).getTime() - new Date(a.endAt).getTime();
  });

  let cluster: string[] = [];
  let columnsEnd: number[] = [];

  const flush = () => {
    const lanes = Math.max(1, columnsEnd.length);
    for (const id of cluster) {
      const prev = out.get(id);
      if (prev) out.set(id, { ...prev, lanes });
    }
    cluster = [];
    columnsEnd = [];
  };

  for (const e of sorted) {
    const start = new Date(e.startAt).getTime();
    const end = new Date(e.endAt).getTime();

    if (cluster.length > 0 && columnsEnd.every((t) => t <= start)) flush();

    let lane = columnsEnd.findIndex((t) => t <= start);
    if (lane === -1) {
      lane = columnsEnd.length;
      columnsEnd.push(end);
    } else {
      columnsEnd[lane] = end;
    }
    out.set(e.id, { lane, lanes: 0 });
    cluster.push(e.id);
  }
  flush();
  return out;
}

// ---------- helpers ----------

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function localInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function formatHm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMinutesAfter(day: Date, minutesFromHoursStart: number): string {
  const d = new Date(day);
  d.setHours(HOURS_START, 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutesFromHoursStart);
  return formatHm(d);
}

function defaultRange() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const end = new Date(now);
  end.setHours(end.getHours() + 1);
  return { startAt: localInput(now), endAt: localInput(end) };
}

function shiftDate(d: Date, dayDelta: number, minutesDelta: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + dayDelta);
  result.setMinutes(result.getMinutes() + minutesDelta);
  return result;
}

function computeDayIndex(clientX: number, grid: HTMLElement): number | null {
  const rect = grid.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const dayCol = (rect.width - HOURS_COL_WIDTH) / 7;
  if (offsetX < HOURS_COL_WIDTH) return 0;
  const idx = Math.floor((offsetX - HOURS_COL_WIDTH) / dayCol);
  if (idx < 0 || idx > 6) return null;
  return idx;
}

function yToMinutes(clientY: number, columnElement: HTMLElement): number {
  const rect = columnElement.getBoundingClientRect();
  const offsetY = clientY - rect.top;
  return (offsetY / HOUR_HEIGHT) * 60;
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Récupère l'élément DOM d'une colonne jour (1-7) dans la grille (col 0 = heures).
 */
function getDayColumn(grid: HTMLElement, dayIndex: number): HTMLElement | null {
  // Children layout : header coin + 7 headers jours + col heures + 7 colonnes jours.
  // Col jour `dayIndex` est à l'index 1 + 7 + 1 + dayIndex = 9 + dayIndex.
  const child = grid.children[9 + dayIndex];
  return child instanceof HTMLElement ? child : null;
}
