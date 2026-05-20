"use client";

import { DateInput } from "@/components/ui/date-input";
import { formatDate } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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

type Props = {
  value: Date | string | null;
  onSave: Saver<string | null>;
  placeholder?: string;
};

/**
 * Éditeur inline single-date pour la sidebar fiche projet ou autres
 * usages similaires. Wrapper autour de `DateInput` (qui porte la
 * grille FR + presets) avec un trigger texte compact pour s'intégrer
 * dans une `<dl>` sans bordure visible.
 */
export function InlineDate({ value, onSave, placeholder = "—" }: Props) {
  const router = useRouter();
  const initial = toIso(value);
  const [displayValue, setDisplayValue] = useState<string | null>(initial);
  useEffect(() => setDisplayValue(initial), [initial]);
  const [pending, startTransition] = useTransition();

  function commit(next: string) {
    const nextOrNull = next === "" ? null : next;
    if ((nextOrNull ?? null) === (displayValue ?? null)) return;
    const prev = displayValue;
    setDisplayValue(nextOrNull);
    startTransition(async () => {
      const res = await onSave(nextOrNull);
      if (!res.ok) {
        setDisplayValue(prev);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DateInput
      value={displayValue ?? ""}
      onValueChange={commit}
      disabled={pending}
      trigger={
        <button
          type="button"
          disabled={pending}
          className="-mx-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {displayValue ? (
            <span className="text-sm">{formatDate(displayValue)}</span>
          ) : (
            <span className="text-muted-foreground text-sm">{placeholder}</span>
          )}
        </button>
      }
    />
  );
}
