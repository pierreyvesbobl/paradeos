"use client";

import { type DateRange, DateRangePicker, formatRange } from "@/components/ui/date-range-picker";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Props = {
  startValue: Date | string | null;
  endValue: Date | string | null;
  /** Reçoit les deux valeurs ISO (ou null) à sauvegarder dans la même
   * mutation. Le wrapper appelant doit dispatcher au bon backend. */
  onSave: (
    startIso: string | null,
    endIso: string | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  placeholder?: string;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.length >= 10) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  return null;
}

function toIso(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Éditeur inline range (start + end) pour la sidebar fiche projet ou
 * autres usages similaires. Trigger texte compact, popover du
 * `DateRangePicker` (drag-to-select + presets FR).
 *
 * Persiste les 2 dates en une seule mutation via `onSave(startIso, endIso)`.
 */
export function InlineDateRange({ startValue, endValue, onSave, placeholder = "—" }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const value: DateRange | null =
    startValue || endValue ? { start: toDate(startValue), end: toDate(endValue) } : null;

  function handleChange(next: DateRange | null) {
    const nextStart = toIso(next?.start ?? null);
    const nextEnd = toIso(next?.end ?? null);
    const currentStart = toIso(toDate(startValue));
    const currentEnd = toIso(toDate(endValue));
    if (nextStart === currentStart && nextEnd === currentEnd) return;

    startTransition(async () => {
      const res = await onSave(nextStart, nextEnd);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DateRangePicker
      value={value}
      onChange={handleChange}
      disabled={pending}
      trigger={
        <button
          type="button"
          disabled={pending}
          className="-mx-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value && (value.start || value.end) ? (
            <span className="text-sm">{formatRange(value)}</span>
          ) : (
            <span className="text-muted-foreground text-sm">{placeholder}</span>
          )}
        </button>
      }
    />
  );
}
