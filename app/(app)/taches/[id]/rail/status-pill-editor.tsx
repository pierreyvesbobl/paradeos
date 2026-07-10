"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import { type TaskStatus, taskStatusEnum, taskStatusLabels } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";
import { CaretDown, Check } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Palette de tons pour le pill de statut. « À faire » sort du lot
 * (bloc plein `--primary-500`) — c'est l'appel à l'action par défaut,
 * choix assumé par le design 1b.
 */
const STATUS_TONE: Record<
  TaskStatus,
  {
    solid?: boolean;
    bg: string;
    text: string;
    dot: string;
  }
> = {
  todo: {
    solid: true,
    bg: "bg-primary text-primary-foreground",
    text: "text-primary-foreground",
    dot: "bg-white/85",
  },
  in_progress: {
    bg: "bg-tint-blue-bg",
    text: "text-tint-blue-text",
    dot: "bg-tint-blue-dot",
  },
  awaiting_client: {
    bg: "bg-tint-yellow-bg",
    text: "text-tint-yellow-text",
    dot: "bg-tint-yellow-dot",
  },
  blocked: {
    bg: "bg-tint-red-bg",
    text: "text-tint-red-text",
    dot: "bg-tint-red-dot",
  },
  done: {
    bg: "bg-tint-green-bg",
    text: "text-tint-green-text",
    dot: "bg-tint-green-dot",
  },
  cancelled: {
    bg: "bg-tint-gray-bg",
    text: "text-tint-gray-text",
    dot: "bg-tint-gray-dot",
  },
};

export function TaskStatusPillEditor({ id, value }: { id: string; value: TaskStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => setDisplayValue(value), [value]);

  function pick(next: TaskStatus) {
    if (next === displayValue) {
      setOpen(false);
      return;
    }
    const prev = displayValue;
    setDisplayValue(next);
    setOpen(false);
    startTransition(async () => {
      const res = await patchTask({ id, status: next });
      if (!res.ok) {
        setDisplayValue(prev);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  const tone = STATUS_TONE[displayValue];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            tone.bg,
            !tone.solid && tone.text,
          )}
        >
          <span className={cn("size-[7px] rounded-full", tone.dot)} />
          <span>{taskStatusLabels[displayValue]}</span>
          <CaretDown size={9} weight="bold" className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1.5">
        <ul className="space-y-0.5">
          {taskStatusEnum.options.map((opt) => {
            const t = STATUS_TONE[opt];
            return (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => pick(opt)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                >
                  <span className={cn("size-2.5 rounded-full", t.dot)} />
                  <span className="flex-1 text-left">{taskStatusLabels[opt]}</span>
                  {opt === displayValue ? (
                    <Check size={12} weight="bold" className="text-primary" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
