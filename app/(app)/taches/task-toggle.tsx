"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { toggleTask } from "@/lib/actions/tasks";
import { useEffect, useState, useTransition } from "react";
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
  // Optimistic — flip de la case immédiat.
  const [displayDone, setDisplayDone] = useState(done);
  useEffect(() => setDisplayDone(done), [done]);

  function onToggle() {
    const prev = displayDone;
    setDisplayDone(!prev);
    startTransition(async () => {
      const result = await toggleTask({ id });
      if (!result.ok) {
        setDisplayDone(prev);
        toast.error(result.message);
      }
    });
  }

  return (
    <Checkbox
      checked={displayDone}
      onCheckedChange={onToggle}
      disabled={pending}
      className={className}
      aria-label={displayDone ? "Marquer comme à faire" : "Marquer comme terminée"}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
