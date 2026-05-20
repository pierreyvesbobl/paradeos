"use client";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import { type TaskPriority, taskPriorityEnum, taskPriorityLabels } from "@/lib/schemas/tasks";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const priorityVariant: Record<TaskPriority, "default" | "secondary" | "outline" | "destructive"> = {
  low: "outline",
  medium: "outline",
  high: "secondary",
  urgent: "destructive",
};

export function TaskPriorityEditor({ id, value }: { id: string; value: TaskPriority }) {
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant={priorityVariant[displayValue]} className="cursor-pointer">
            {taskPriorityLabels[displayValue]}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1">
        <ul className="space-y-0.5">
          {taskPriorityEnum.options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => pick(opt)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span>{taskPriorityLabels[opt]}</span>
                {opt === displayValue ? <Check className="size-3.5" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
