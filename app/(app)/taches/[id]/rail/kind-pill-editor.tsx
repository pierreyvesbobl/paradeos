"use client";

import { CaretDown, Check } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import {
  TASK_KINDS,
  type TaskKind,
  taskKindDescriptions,
  taskKindLabels,
} from "@/lib/tasks/task-kind";
import { cn } from "@/lib/utils";

const KIND_TONE: Record<TaskKind | "none", { bg: string; text: string; dot: string }> = {
  feature: { bg: "bg-tint-blue-bg", text: "text-tint-blue-text", dot: "bg-tint-blue-dot" },
  investigation: {
    bg: "bg-tint-yellow-bg",
    text: "text-tint-yellow-text",
    dot: "bg-tint-yellow-dot",
  },
  action: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
  none: { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-border" },
};

/**
 * Nature de la tâche, dans le rail de la fiche. Passer en
 * « Fonctionnalité » déclenche la projection en issue GitHub si le projet
 * projette (cf. patchTask).
 */
export function TaskKindPillEditor({ id, value }: { id: string; value: TaskKind | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [displayValue, setDisplayValue] = useState<TaskKind | null>(value);
  useEffect(() => setDisplayValue(value), [value]);

  function pick(next: TaskKind | null) {
    if (next === displayValue) {
      setOpen(false);
      return;
    }
    const prev = displayValue;
    setDisplayValue(next);
    setOpen(false);
    startTransition(async () => {
      const res = await patchTask({ id, kind: next });
      if (!res.ok) {
        setDisplayValue(prev);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  const tone = KIND_TONE[displayValue ?? "none"];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40",
            tone.bg,
            tone.text,
          )}
        >
          <span className={cn("size-[7px] rounded-full", tone.dot)} />
          <span>{displayValue ? taskKindLabels[displayValue] : "Non typée"}</span>
          <CaretDown size={9} weight="bold" className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <ul className="space-y-0.5">
          {TASK_KINDS.map((opt) => {
            const t = KIND_TONE[opt];
            return (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => pick(opt)}
                  className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                >
                  <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", t.dot)} />
                  <span className="flex-1 text-left">
                    <span className="block">{taskKindLabels[opt]}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {taskKindDescriptions[opt]}
                    </span>
                  </span>
                  {opt === displayValue ? (
                    <Check size={12} weight="bold" className="mt-1 text-primary" />
                  ) : null}
                </button>
              </li>
            );
          })}
          {displayValue ? (
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-muted-foreground text-sm hover:bg-muted"
              >
                <span className="size-2.5 rounded-full bg-border" />
                <span className="flex-1 text-left">Non typée</span>
              </button>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
