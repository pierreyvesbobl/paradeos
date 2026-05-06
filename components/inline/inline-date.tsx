"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { Saver } from "./types";

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
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

type Props = {
  value: Date | string | null;
  onSave: Saver<string | null>;
  placeholder?: string;
};

export function InlineDate({ value, onSave, placeholder = "—" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initial = toIso(value);
  const [pending, startTransition] = useTransition();

  function commit(next: string | null) {
    if ((next ?? null) === (initial ?? null)) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await onSave(next);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="-mx-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value ? (
            <span>{formatDate(value)}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
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
              disabled={pending}
              onClick={() => commit(toIso(p.offset()))}
            >
              {p.label}
            </Button>
          ))}
          {initial ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 h-7 w-full justify-start px-2 text-muted-foreground text-xs"
              disabled={pending}
              onClick={() => commit(null)}
            >
              <X className="mr-1.5 size-3" />
              Effacer
            </Button>
          ) : null}
        </div>
        <Calendar
          mode="single"
          selected={parseLocalDate(initial)}
          onSelect={(d) => commit(d ? toIso(d) : null)}
          defaultMonth={parseLocalDate(initial) ?? startOfToday()}
        />
      </PopoverContent>
    </Popover>
  );
}
