"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { toggleTask } from "@/lib/actions/tasks";
import { useTransition } from "react";
import { toast } from "sonner";

export function TaskToggle({
  id,
  done,
  className,
}: {
  id: string;
  done: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  function onToggle() {
    startTransition(async () => {
      const result = await toggleTask({ id });
      if (!result.ok) toast.error(result.message);
    });
  }

  return (
    <Checkbox
      checked={done}
      onCheckedChange={onToggle}
      disabled={pending}
      className={className}
      aria-label={done ? "Marquer comme à faire" : "Marquer comme terminée"}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
