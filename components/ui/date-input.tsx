"use client";

import { Button } from "@/components/ui/button";
import {
  DAY_LABELS,
  addDays,
  addMonths,
  buildMonthDays,
  formatIsoDate,
  isSameDay,
  parseIsoDate,
  startOfDay,
  startOfMonth,
} from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

const FMT_MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
});

type Props = {
  /** Date au format `YYYY-MM-DD` ; chaîne vide = aucune date. */
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Trigger custom (ex. inline texte sans bordure). Si fourni, remplace
   * le bouton outlined par défaut. */
  trigger?: ReactNode;
};

const PRESETS: { label: string; offset: () => Date }[] = [
  { label: "Aujourd'hui", offset: () => startOfDay(new Date()) },
  { label: "Demain", offset: () => addDays(startOfDay(new Date()), 1) },
  { label: "Dans 3 jours", offset: () => addDays(startOfDay(new Date()), 3) },
  { label: "Dans 1 semaine", offset: () => addDays(startOfDay(new Date()), 7) },
  { label: "Dans 1 mois", offset: () => addMonths(startOfDay(new Date()), 1) },
];

/**
 * Picker single-date au visuel identique au `DateRangePicker` :
 * trigger Button + popover avec presets gauche + grille custom FR à
 * droite. Click simple sur un jour = sélection + fermeture.
 *
 * API conservée (`value: string`, `onValueChange`) pour rester drop-in
 * sur les forms existants.
 */
export function DateInput({
  value,
  onValueChange,
  id,
  placeholder = "—",
  disabled = false,
  className,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const [month, setMonth] = useState<Date>(() => startOfMonth(selected ?? new Date()));

  // Recale le mois affiché à l'ouverture. On dépend de `value` (string)
  // et pas de `selected` (Date recréée à chaque render → boucle infinie
  // d'updates). À l'ouverture seulement : pas envie d'écraser la nav
  // de l'user pendant qu'il regarde un autre mois.
  useEffect(() => {
    if (open) {
      const next = parseIsoDate(value);
      setMonth(startOfMonth(next ?? new Date()));
    }
  }, [open, value]);

  function pick(date: Date | null) {
    onValueChange(date ? formatIsoDate(date) : "");
    setOpen(false);
  }

  const days = useMemo(() => buildMonthDays(month), [month]);
  const today = useMemo(() => startOfDay(new Date()), []);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("h-9 w-full justify-start gap-2 px-3 font-normal", className)}
            aria-expanded={open}
          >
            <CalendarIcon className="size-3.5 shrink-0" />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? formatDate(selected) : placeholder}
            </span>
            {selected ? (
              // biome-ignore lint/a11y/useSemanticElements: <button> imbriqué interdit (le trigger Radix est déjà un button)
              <span
                role="button"
                tabIndex={0}
                aria-label="Effacer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  pick(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(null);
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
        <div className="flex w-32 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              onClick={() => pick(p.offset())}
              className="rounded px-2 py-1 text-left text-sm hover:bg-background hover:shadow-sm"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="w-[260px] select-none p-2">
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
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const isOtherMonth = d.getMonth() !== month.getMonth();
              const isToday = isSameDay(d, today);
              const isSelected = selected ? isSameDay(d, selected) : false;
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => pick(d)}
                  className={cn(
                    "relative flex h-8 items-center justify-center text-sm",
                    isOtherMonth ? "text-muted-foreground/40" : "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "z-10 flex size-7 items-center justify-center rounded-md",
                      isSelected && "bg-primary font-medium text-primary-foreground",
                      !isSelected && isToday && "ring-1 ring-primary/60",
                      !isSelected && "hover:bg-muted",
                    )}
                  >
                    {d.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between border-t pt-1.5">
            <button
              type="button"
              onClick={() => pick(null)}
              disabled={!selected}
              className="text-muted-foreground text-xs hover:text-foreground disabled:opacity-40"
            >
              Effacer
            </button>
            <span className="text-[11px] text-muted-foreground">Clique pour sélectionner</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
