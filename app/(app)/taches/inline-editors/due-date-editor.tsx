"use client";

import { DateInput } from "@/components/ui/date-input";
import { patchTask } from "@/lib/actions/tasks";
import { formatDate } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  return value.toISOString().slice(0, 10);
}

/**
 * Édition inline de la `due_date` d'une tâche depuis la liste, branchée
 * sur le `DateInput` global (grille FR + presets) via un trigger texte
 * compact.
 */
export function TaskDueDateEditor({
  id,
  value,
}: {
  id: string;
  value: Date | string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = toIsoDate(value);

  function commit(next: string) {
    const nextOrNull = next === "" ? null : next;
    if ((nextOrNull ?? null) === (initial ?? null)) return;
    startTransition(async () => {
      const res = await patchTask({ id, dueDate: nextOrNull });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DateInput
      value={initial ?? ""}
      onValueChange={commit}
      disabled={pending}
      trigger={
        <button
          type="button"
          disabled={pending}
          className="rounded-sm px-1.5 py-0.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value ? (
            <span>{formatDate(value)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </button>
      }
    />
  );
}
