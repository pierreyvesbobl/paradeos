"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import { type TaskPriority, taskPriorityEnum, taskPriorityLabels } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";
import { CaretDown, Check } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const PRIO_TONE: Record<TaskPriority, { bg: string; text: string; dot: string }> = {
  low: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
  medium: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
  high: { bg: "bg-tint-yellow-bg", text: "text-tint-yellow-text", dot: "bg-tint-yellow-dot" },
  urgent: { bg: "bg-tint-red-bg", text: "text-tint-red-text", dot: "bg-tint-red-dot" },
};

export function TaskPriorityPillEditor({ id, value }: { id: string; value: TaskPriority }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => setDisplayValue(value), [value]);

  function pick(next: TaskPriority) {
    if (next === displayValue) {
      setOpen(false);
      return;
    }
    const prev = displayValue;
    setDisplayValue(next);
    setOpen(false);
    startTransition(async () => {
      const res = await patchTask({ id, priority: next });
      if (!res.ok) {
        setDisplayValue(prev);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  const tone = PRIO_TONE[displayValue];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            tone.bg,
            tone.text,
          )}
        >
          <span className={cn("size-[7px] rounded-full", tone.dot)} />
          <span>{taskPriorityLabels[displayValue]}</span>
          <CaretDown size={9} weight="bold" className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1.5">
        <ul className="space-y-0.5">
          {taskPriorityEnum.options.map((opt) => {
            const t = PRIO_TONE[opt];
            return (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => pick(opt)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                >
                  <span className={cn("size-2.5 rounded-full", t.dot)} />
                  <span className="flex-1 text-left">{taskPriorityLabels[opt]}</span>
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
