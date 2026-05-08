"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import { formatDate } from "@/lib/format";
import { CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  return value.toISOString().slice(0, 10);
}

/**
 * Éditeur d'intervalle (start_date + due_date) pour une tâche, dans un
 * seul popover. Les deux dates sont indépendantes — on peut en avoir
 * une, l'autre, les deux, ou aucune.
 *
 * Utile pour la planification Gantt : permet de définir l'intervalle
 * complet d'un coup (sinon il faut éditer dueDate puis startDate
 * séparément, et il n'y a pas d'éditeur startDate inline).
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
  /** "inline" = trigger texte minimal, "labeled" = trigger avec icône + label. */
  variant?: "inline" | "labeled";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialStart = toIsoDate(startDate);
  const initialDue = toIsoDate(dueDate);
  const [draftStart, setDraftStart] = useState<string>(initialStart ?? "");
  const [draftDue, setDraftDue] = useState<string>(initialDue ?? "");

  function commit() {
    const nextStart = draftStart || null;
    const nextDue = draftDue || null;
    if (nextStart && nextDue && nextStart > nextDue) {
      toast.error("La date de début doit précéder ou égaler l'échéance.");
      return;
    }
    const startChanged = (nextStart ?? null) !== (initialStart ?? null);
    const dueChanged = (nextDue ?? null) !== (initialDue ?? null);
    if (!startChanged && !dueChanged) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const payload: { id: string; startDate?: string | null; dueDate?: string | null } = {
        id,
      };
      if (startChanged) payload.startDate = nextStart;
      if (dueChanged) payload.dueDate = nextDue;
      const res = await patchTask(payload);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function clearAll() {
    startTransition(async () => {
      const res = await patchTask({ id, startDate: null, dueDate: null });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDraftStart("");
      setDraftDue("");
      setOpen(false);
      router.refresh();
    });
  }

  const displayLabel = (() => {
    if (initialStart && initialDue) {
      return initialStart === initialDue
        ? formatDate(initialStart)
        : `${formatDate(initialStart)} → ${formatDate(initialDue)}`;
    }
    if (initialDue) return formatDate(initialDue);
    if (initialStart) return `${formatDate(initialStart)} → ?`;
    return null;
  })();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDraftStart(initialStart ?? "");
          setDraftDue(initialDue ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        {variant === "inline" ? (
          <button
            type="button"
            disabled={pending}
            className="rounded-sm px-1.5 py-0.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {displayLabel ? (
              <span>{displayLabel}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pending} className="gap-1.5">
            <CalendarRange className="size-3.5" />
            {displayLabel ?? "Définir l'intervalle"}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="space-y-1.5">
          <label htmlFor={`start-${id}`} className="font-medium text-muted-foreground text-xs">
            Début
          </label>
          <input
            id={`start-${id}`}
            type="date"
            value={draftStart}
            onChange={(e) => setDraftStart(e.target.value)}
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`due-${id}`} className="font-medium text-muted-foreground text-xs">
            Échéance
          </label>
          <input
            id={`due-${id}`}
            type="date"
            value={draftDue}
            onChange={(e) => setDraftDue(e.target.value)}
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={pending || (!initialStart && !initialDue)}
          >
            Effacer
          </Button>
          <Button type="button" size="sm" onClick={commit} disabled={pending}>
            Valider
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
