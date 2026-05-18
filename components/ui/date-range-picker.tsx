"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

// Formatters Intl FR (cohérent avec lib/format.ts).
const FMT_MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
});
const FMT_FULL = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const FMT_DAY_MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const FMT_DAY_MONTH = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
});
const FMT_DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric" });

export const DAY_LABELS = [
  { key: "lun", label: "L" },
  { key: "mar", label: "M" },
  { key: "mer", label: "M" },
  { key: "jeu", label: "J" },
  { key: "ven", label: "V" },
  { key: "sam", label: "S" },
  { key: "dim", label: "D" },
];

export type DateRange = { start: Date | null; end: Date | null };

export type DateRangePreset = {
  label: string;
  build: () => DateRange;
};

type DragState = { start: Date; current: Date } | null;

type Props = {
  value: DateRange | null;
  onChange: (value: DateRange | null) => void;
  placeholder?: string;
  presets?: DateRangePreset[];
  disabled?: boolean;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "default" | "sm";
  className?: string;
  trigger?: ReactNode;
};

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Sélectionner une période",
  presets = defaultPresets(),
  disabled,
  triggerVariant = "outline",
  triggerSize = "sm",
  className,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() =>
    startOfMonth(value?.start ?? value?.end ?? new Date()),
  );
  const [drag, setDrag] = useState<DragState>(null);
  const [hover, setHover] = useState<Date | null>(null);
  // Champs texte JJ/MM/AAAA — édition libre, commit sur blur/Enter.
  const [startText, setStartText] = useState(() => formatFrDate(value?.start ?? null));
  const [endText, setEndText] = useState(() => formatFrDate(value?.end ?? null));
  const [startInvalid, setStartInvalid] = useState(false);
  const [endInvalid, setEndInvalid] = useState(false);

  // Refs pour accéder à la dernière valeur dans les listeners window.
  const dragRef = useRef<DragState>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Recale le mois à l'ouverture seulement. On dépend de `open` (et
  // PAS de `value` qui est un objet recréé à chaque render des
  // parents → boucle infinie). On lit la dernière `value` via la ref.
  useEffect(() => {
    if (open) {
      const v = valueRef.current;
      setMonth(startOfMonth(v?.start ?? v?.end ?? new Date()));
      setDrag(null);
      setHover(null);
      setStartText(formatFrDate(v?.start ?? null));
      setEndText(formatFrDate(v?.end ?? null));
      setStartInvalid(false);
      setEndInvalid(false);
    }
  }, [open]);

  // Resynchronise les champs texte quand la valeur change depuis
  // l'extérieur (clic dans le calendrier, preset, parent qui maj).
  // Deps en primitif (timestamps) pour éviter la boucle d'objets.
  const startTime = value?.start ? value.start.getTime() : 0;
  const endTime = value?.end ? value.end.getTime() : 0;
  useEffect(() => {
    setStartText(startTime ? formatFrDate(new Date(startTime)) : "");
    setStartInvalid(false);
  }, [startTime]);
  useEffect(() => {
    setEndText(endTime ? formatFrDate(new Date(endTime)) : "");
    setEndInvalid(false);
  }, [endTime]);

  function commitStart(raw: string) {
    if (raw.trim() === "") {
      const currentEnd = valueRef.current?.end ?? null;
      onChange(currentEnd ? { start: null, end: currentEnd } : null);
      setStartInvalid(false);
      return;
    }
    const parsed = parseFrDate(raw);
    if (!parsed) {
      setStartInvalid(true);
      return;
    }
    setStartInvalid(false);
    let nextStart: Date = startOfDay(parsed);
    let nextEnd: Date | null = valueRef.current?.end ? endOfDay(valueRef.current.end) : null;
    if (nextEnd && nextStart > nextEnd) {
      const swapEnd = endOfDay(nextStart);
      nextStart = startOfDay(nextEnd);
      nextEnd = swapEnd;
    }
    onChange({ start: nextStart, end: nextEnd });
    setMonth(startOfMonth(nextStart));
  }

  function commitEnd(raw: string) {
    if (raw.trim() === "") {
      const currentStart = valueRef.current?.start ?? null;
      onChange(currentStart ? { start: currentStart, end: null } : null);
      setEndInvalid(false);
      return;
    }
    const parsed = parseFrDate(raw);
    if (!parsed) {
      setEndInvalid(true);
      return;
    }
    setEndInvalid(false);
    let nextStart: Date | null = valueRef.current?.start
      ? startOfDay(valueRef.current.start)
      : null;
    let nextEnd: Date = endOfDay(parsed);
    if (nextStart && nextStart > nextEnd) {
      const swapStart = startOfDay(nextEnd);
      nextEnd = endOfDay(nextStart);
      nextStart = swapStart;
    }
    onChange({ start: nextStart, end: nextEnd });
    setMonth(startOfMonth(nextEnd));
  }

  // Listener window : finalise le drag au pointerup, peu importe où le
  // pointeur est relâché. Sans ça, lâcher en dehors d'une cellule
  // laisse le drag dans un état zombie.
  useEffect(() => {
    function onUp() {
      const d = dragRef.current;
      if (!d) return;
      const dragged = !isSameDay(d.start, d.current);
      if (dragged) {
        const [a, b] = d.start <= d.current ? [d.start, d.current] : [d.current, d.start];
        onChange({ start: startOfDay(a), end: endOfDay(b) });
        setOpen(false);
      } else {
        // Pas de drag réel : pose le start, attend le 2e clic pour
        // poser le end. Cas "click-then-click" classique.
        onChange({ start: startOfDay(d.start), end: null });
      }
      setDrag(null);
    }
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onChange]);

  function onPointerDownDay(day: Date, e: React.PointerEvent) {
    e.preventDefault();
    const v = valueRef.current;
    // Si on a un start sans end → 2e clic = pose le end et ferme.
    if (v?.start && !v.end) {
      const [a, b] = v.start <= day ? [v.start, day] : [day, v.start];
      onChange({ start: startOfDay(a), end: endOfDay(b) });
      setOpen(false);
      return;
    }
    // Sinon démarre un drag (ou un click simple — décidé au pointerup).
    setDrag({ start: day, current: day });
  }

  function onPointerEnterDay(day: Date) {
    if (dragRef.current) {
      setDrag({ start: dragRef.current.start, current: day });
    } else {
      const v = valueRef.current;
      if (v?.start && !v.end) setHover(day);
    }
  }

  function pickPreset(p: DateRangePreset) {
    onChange(p.build());
    setOpen(false);
  }

  function clearAndClose() {
    onChange(null);
    setOpen(false);
  }

  const label = value && (value.start || value.end) ? formatRange(value) : null;

  // Range visuel à highlight : drag en cours > sélection finale > hover preview.
  const visualRange: { start: Date; end: Date } | null = (() => {
    if (drag) {
      return drag.start <= drag.current
        ? { start: drag.start, end: drag.current }
        : { start: drag.current, end: drag.start };
    }
    if (value?.start && value?.end) {
      return { start: value.start, end: value.end };
    }
    if (value?.start && !value.end && hover) {
      return value.start <= hover
        ? { start: value.start, end: hover }
        : { start: hover, end: value.start };
    }
    return null;
  })();

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant={triggerVariant}
            size={triggerSize}
            disabled={disabled}
            className={cn("justify-start gap-2 font-normal", className)}
          >
            <CalendarIcon className="size-3.5 shrink-0" />
            <span className={cn("truncate", !label && "text-muted-foreground")}>
              {label ?? placeholder}
            </span>
            {label ? (
              // biome-ignore lint/a11y/useSemanticElements: <button> imbriqué interdit (le trigger Radix est déjà un button)
              <span
                role="button"
                tabIndex={0}
                aria-label="Effacer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(null);
                  }
                }}
                className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </span>
            ) : null}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto p-0" sideOffset={4}>
        {presets.length > 0 ? (
          <div className="flex w-40 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2">
            {presets.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => pickPreset(p)}
                className="rounded px-2 py-1 text-left text-sm hover:bg-background hover:shadow-sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="w-[260px] select-none p-2">
          <div className="flex gap-1.5 pb-2">
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Du</span>
              <input
                type="text"
                inputMode="numeric"
                value={startText}
                placeholder="JJ/MM/AAAA"
                onChange={(e) => setStartText(e.target.value)}
                onBlur={() => commitStart(startText)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitStart(startText);
                  }
                }}
                className={cn(
                  "h-7 w-full rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring",
                  startInvalid && "border-destructive focus:ring-destructive",
                )}
              />
            </label>
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Au</span>
              <input
                type="text"
                inputMode="numeric"
                value={endText}
                placeholder="JJ/MM/AAAA"
                onChange={(e) => setEndText(e.target.value)}
                onBlur={() => commitEnd(endText)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEnd(endText);
                  }
                }}
                className={cn(
                  "h-7 w-full rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring",
                  endInvalid && "border-destructive focus:ring-destructive",
                )}
              />
            </label>
          </div>
          <header className="flex items-center justify-between px-1.5 pb-2">
            <span className="font-medium text-foreground text-sm capitalize">
              {FMT_MONTH_YEAR.format(month)}
            </span>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, -1))}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Mois précédent"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, 1))}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Mois suivant"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </header>
          <div className="grid grid-cols-7 px-px text-center text-[10px] text-muted-foreground">
            {DAY_LABELS.map((d) => (
              <div key={d.key} className="py-1">
                {d.label}
              </div>
            ))}
          </div>
          <MonthGrid
            month={month}
            visualRange={visualRange}
            onPointerDownDay={onPointerDownDay}
            onPointerEnterDay={onPointerEnterDay}
            onPointerLeaveGrid={() => {
              if (!dragRef.current) setHover(null);
            }}
          />
          <div className="mt-1 flex items-center justify-between border-t pt-1.5">
            <button
              type="button"
              onClick={clearAndClose}
              disabled={!value || (!value.start && !value.end)}
              className="text-muted-foreground text-xs hover:text-foreground disabled:opacity-40"
            >
              Effacer
            </button>
            <span className="text-[11px] text-muted-foreground">
              Glisse pour sélectionner un intervalle
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthGrid({
  month,
  visualRange,
  onPointerDownDay,
  onPointerEnterDay,
  onPointerLeaveGrid,
}: {
  month: Date;
  visualRange: { start: Date; end: Date } | null;
  onPointerDownDay: (d: Date, e: React.PointerEvent) => void;
  onPointerEnterDay: (d: Date) => void;
  onPointerLeaveGrid: () => void;
}) {
  const days = useMemo(() => buildMonthDays(month), [month]);
  const today = useMemo(() => startOfDay(new Date()), []);

  return (
    <div className="grid grid-cols-7" onPointerLeave={onPointerLeaveGrid}>
      {days.map((d) => {
        const isOtherMonth = d.getMonth() !== month.getMonth();
        const isToday = isSameDay(d, today);
        const inRange =
          visualRange && d >= startOfDay(visualRange.start) && d <= startOfDay(visualRange.end);
        const isStart = visualRange && isSameDay(d, visualRange.start);
        const isEnd = visualRange && isSameDay(d, visualRange.end);
        const isSingle = visualRange && isSameDay(visualRange.start, visualRange.end);

        return (
          <button
            key={d.toISOString()}
            type="button"
            onPointerDown={(e) => onPointerDownDay(d, e)}
            onPointerEnter={() => onPointerEnterDay(d)}
            className={cn(
              // Conteneur jour : pas de gap pour que le bg du range soit
              // continu d'une cellule à l'autre.
              "relative flex h-8 items-center justify-center text-sm",
              isOtherMonth ? "text-muted-foreground/40" : "text-foreground",
              // Range middle : bg léger, pas de border-radius (continuité)
              inRange && !isStart && !isEnd && "bg-primary/15",
              // Start/End : bg plein, rounded côté extérieur seulement
              isStart && !isSingle && "rounded-l-md bg-primary/15",
              isEnd && !isSingle && "rounded-r-md bg-primary/15",
            )}
          >
            <span
              className={cn(
                "z-10 flex size-7 items-center justify-center rounded-md",
                (isStart || isEnd) && "bg-primary font-medium text-primary-foreground",
                !isStart && !isEnd && isToday && "ring-1 ring-primary/60",
                !isStart && !isEnd && !inRange && "hover:bg-muted",
              )}
            >
              {d.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- helpers (exposés pour DateInput single) ----------

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
export function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  return endOfDay(x);
}
function startOfWeekMon(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  return x;
}
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Construit la grille 6×7 d'un mois : commence au lundi avant ou égal
 * au 1er du mois, finit au dimanche après ou égal au dernier jour.
 * Padding par les jours du mois précédent/suivant.
 */
export function buildMonthDays(month: Date): Date[] {
  const monthStart = startOfMonth(month);
  const gridStart = startOfWeekMon(monthStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(addDays(gridStart, i));
  }
  return days;
}

/** Presets FR par défaut, dans l'ordre habituel d'usage. */
export function defaultPresets(): DateRangePreset[] {
  return [
    {
      label: "Aujourd'hui",
      build: () => {
        const t = startOfDay(new Date());
        return { start: t, end: endOfDay(t) };
      },
    },
    {
      label: "Hier",
      build: () => {
        const y = addDays(startOfDay(new Date()), -1);
        return { start: y, end: endOfDay(y) };
      },
    },
    {
      label: "7 derniers jours",
      build: () => {
        const today = startOfDay(new Date());
        return { start: addDays(today, -6), end: endOfDay(today) };
      },
    },
    {
      label: "30 derniers jours",
      build: () => {
        const today = startOfDay(new Date());
        return { start: addDays(today, -29), end: endOfDay(today) };
      },
    },
    {
      label: "Cette semaine",
      build: () => {
        const monday = startOfWeekMon(new Date());
        return { start: monday, end: endOfDay(addDays(monday, 6)) };
      },
    },
    {
      label: "Semaine dernière",
      build: () => {
        const lastMonday = addDays(startOfWeekMon(new Date()), -7);
        return { start: lastMonday, end: endOfDay(addDays(lastMonday, 6)) };
      },
    },
    {
      label: "Mois en cours",
      build: () => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()) }),
    },
    {
      label: "Mois précédent",
      build: () => {
        const t = new Date();
        const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
        return { start: startOfMonth(prev), end: endOfMonth(prev) };
      },
    },
    {
      label: "Année en cours",
      build: () => {
        const y = new Date().getFullYear();
        return {
          start: startOfDay(new Date(y, 0, 1)),
          end: endOfDay(new Date(y, 11, 31)),
        };
      },
    },
  ];
}

/** Helpers ISO ↔ Date pour brancher facilement le picker sur des
 * formulaires qui stockent leurs dates en `YYYY-MM-DD`. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso || iso.length < 10) return null;
  const parts = iso.slice(0, 10).split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse une saisie utilisateur en FR : `DD/MM/YYYY`, `DD-MM-YYYY`,
 * `DD.MM.YYYY` ou `DDMMYYYY`. Tolère `DD/MM/YY` (préfixé 20). Retourne
 * `null` si invalide ; valide les bornes du jour réel (28/02 ≠ 30/02).
 */
export function parseFrDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  // Accepte aussi ISO YYYY-MM-DD si l'utilisateur colle ce format.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return buildDateChecked(y, m, d);
  }
  const m = /^(\d{1,2})[\s./-]?(\d{1,2})[\s./-]?(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return buildDateChecked(year, month, day);
}

function buildDateChecked(y: number, m: number, d: number): Date | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const out = new Date(y, m - 1, d);
  // setDate accepte 31/02 puis le renormalise → on revérifie l'identité.
  if (out.getFullYear() !== y || out.getMonth() !== m - 1 || out.getDate() !== d) return null;
  return startOfDay(out);
}

/** Format `DD/MM/YYYY` ou chaîne vide. */
export function formatFrDate(d: Date | null): string {
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

/** Format compact FR adapté au cas. */
export function formatRange(r: DateRange): string {
  const { start, end } = r;
  if (!start && !end) return "";
  if (start && !end) return `Dès le ${FMT_DAY_MONTH_YEAR.format(start)}`;
  if (!start && end) return `Jusqu'au ${FMT_DAY_MONTH_YEAR.format(end)}`;
  if (!start || !end) return "";

  if (isSameDay(start, end)) return FMT_FULL.format(start);

  const sameMonth =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${FMT_DAY.format(start)} → ${FMT_DAY_MONTH_YEAR.format(end)}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `${FMT_DAY_MONTH.format(start)} → ${FMT_DAY_MONTH_YEAR.format(end)}`;
  }
  return `${FMT_DAY_MONTH_YEAR.format(start)} → ${FMT_DAY_MONTH_YEAR.format(end)}`;
}
