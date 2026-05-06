"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CalendarIcon, X } from "lucide-react";
import { useState } from "react";

type Props = {
  /** Date au format "YYYY-MM-DD" ; chaîne vide = aucune date. */
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function parseLocalDate(iso: string): Date | undefined {
  if (!iso || iso.length < 10) return undefined;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

const PRESETS: { label: string; offset: () => Date }[] = [
  { label: "Aujourd'hui", offset: () => startOfToday() },
  { label: "Demain", offset: () => addDays(startOfToday(), 1) },
  { label: "Dans 3 jours", offset: () => addDays(startOfToday(), 3) },
  { label: "Dans 1 semaine", offset: () => addDays(startOfToday(), 7) },
  { label: "Dans 1 mois", offset: () => addMonths(startOfToday(), 1) },
];

export function DateInput({
  value,
  onValueChange,
  id,
  placeholder = "—",
  disabled = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);

  function pick(date: Date | undefined) {
    onValueChange(date ? toIsoDate(date) : "");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {selected ? (
            <span>{formatDate(selected)}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <CalendarIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto items-stretch p-0">
        <div className="flex w-32 flex-col gap-0.5 border-r p-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-full justify-start px-2 text-xs"
              onClick={() => pick(p.offset())}
            >
              {p.label}
            </Button>
          ))}
          {selected ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 h-7 w-full justify-start px-2 text-muted-foreground text-xs"
              onClick={() => pick(undefined)}
            >
              <X className="mr-1.5 size-3" />
              Effacer
            </Button>
          ) : null}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={pick}
          defaultMonth={selected ?? startOfToday()}
        />
      </PopoverContent>
    </Popover>
  );
}
