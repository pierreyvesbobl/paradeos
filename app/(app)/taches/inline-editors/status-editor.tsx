"use client";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import { type TaskStatus, taskStatusEnum, taskStatusLabels } from "@/lib/schemas/tasks";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const statusVariant: Record<TaskStatus, "default" | "secondary" | "outline" | "destructive"> = {
  todo: "outline",
  in_progress: "default",
  awaiting_client: "secondary",
  blocked: "destructive",
  done: "secondary",
  cancelled: "outline",
};

export function TaskStatusEditor({ id, value }: { id: string; value: TaskStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic — bascule visuelle immédiate, rollback si échec.
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant={statusVariant[displayValue]} className="cursor-pointer">
            {taskStatusLabels[displayValue]}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <ul className="space-y-0.5">
          {taskStatusEnum.options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => pick(opt)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span>{taskStatusLabels[opt]}</span>
                {opt === displayValue ? <Check className="size-3.5" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
