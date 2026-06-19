"use client";

import { toggleTask } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Case carrée 18×18 — sert UNIQUEMENT à terminer la tâche (toggle status).
 * Volontairement séparée de la sélection : clic sur la case ≠ clic sur la
 * ligne, et le clic ne propage pas pour ne pas déclencher la sélection
 * multiple de la ligne parente.
 */
export function TaskCheckbox({
  id,
  done,
  className,
}: {
  id: string;
  done: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState(done);
  const [pending, startTransition] = useTransition();
  useEffect(() => setOptimistic(done), [done]);

  function commit(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const res = await toggleTask({ id });
      if (!res.ok) {
        setOptimistic(!next);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={commit}
      disabled={pending}
      aria-label={optimistic ? "Marquer comme à faire" : "Marquer comme terminée"}
      aria-pressed={optimistic}
      className={cn(
        "donebox inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-ds-border-strong bg-ds-app outline-none transition-colors hover:border-ds-text-muted focus-visible:ring-2 focus-visible:ring-ring",
        optimistic && "border-primary-500 bg-primary-500",
        className,
      )}
    >
      <Check
        className={cn(
          "size-[11px] stroke-[3] transition-opacity",
          optimistic
            ? "text-white opacity-100"
            : "text-ds-text-muted opacity-0 group-hover/row:opacity-[0.32]",
        )}
      />
    </button>
  );
}
