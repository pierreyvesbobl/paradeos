"use client";

import { type DateRange, DateRangePicker, formatRange } from "@/components/ui/date-range-picker";
import { patchTask } from "@/lib/actions/tasks";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  return value.toISOString().slice(0, 10);
}

function dateFromIso(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.length >= 10) return new Date(`${value.slice(0, 10)}T00:00:00`);
  return null;
}

/**
 * Éditeur d'intervalle (start_date + due_date) pour une tâche.
 * Branche le `DateRangePicker` global (calendar range + presets FR)
 * sur la mutation `patchTask`. Le `variant` `inline` rend un trigger
 * texte minimal pour les usages dans des dl ; `labeled` rend un bouton
 * outlined avec icône.
 */
export function TaskScheduleEditor({
  id,
  startDate,
  dueDate,
  variant = "inline",
}: {
  id: string;
  startDate: Date | string | null;
  dueDate: Date | string | null;
  variant?: "inline" | "labeled";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const value: DateRange | null =
    startDate || dueDate ? { start: dateFromIso(startDate), end: dateFromIso(dueDate) } : null;

  function commit(next: DateRange | null) {
    const nextStart = next?.start ? toIsoDate(next.start) : null;
    const nextEnd = next?.end ? toIsoDate(next.end) : null;
    const currentStart = toIsoDate(startDate);
    const currentEnd = toIsoDate(dueDate);
    if (nextStart === currentStart && nextEnd === currentEnd) return;

    startTransition(async () => {
      const res = await patchTask({
        id,
        startDate: nextStart,
        dueDate: nextEnd,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  if (variant === "inline") {
    const label = value ? formatRange(value) : null;
    return (
      <DateRangePicker
        value={value}
        onChange={commit}
        disabled={pending}
        triggerVariant="ghost"
        triggerSize="sm"
        trigger={
          <button
            type="button"
            disabled={pending}
            className="rounded-sm px-1.5 py-0.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label ? <span>{label}</span> : <span className="text-muted-foreground">—</span>}
          </button>
        }
      />
    );
  }

  return (
    <DateRangePicker
      value={value}
      onChange={commit}
      disabled={pending}
      placeholder="Définir l'intervalle"
      triggerVariant="outline"
      triggerSize="sm"
    />
  );
}
