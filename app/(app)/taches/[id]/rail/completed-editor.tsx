"use client";

import { DateInput } from "@/components/ui/date-input";
import { patchTask } from "@/lib/actions/tasks";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Check, CheckCircle, X } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  return value.toISOString().slice(0, 10);
}

/**
 * Éditeur inline « Terminée le ». Deux états visuels :
 * - vide : chip pointillé « Marquer terminée » (ouvre le picker) ; picker
 *   rempli ⇒ status = done + completedAt = date choisie.
 * - rempli : bordure pleine + date FR + ✕ ; ✕ ⇒ status = todo + completedAt = null.
 *
 * `completedAt` et `status` sont patch-és ensemble côté client pour que
 * la sémantique « terminée / non terminée » reste cohérente sans que le
 * serveur ait à deviner.
 */
export function TaskCompletedEditor({
  id,
  value,
}: {
  id: string;
  value: Date | string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const iso = toIsoDate(value);
  const filled = !!iso;

  function commit(next: string) {
    if (!next) {
      clear();
      return;
    }
    startTransition(async () => {
      const res = await patchTask({ id, completedAt: next, status: "done" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  function clear() {
    startTransition(async () => {
      const res = await patchTask({ id, completedAt: null, status: "todo" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <DateInput
        value={iso ?? ""}
        onValueChange={commit}
        trigger={
          filled ? (
            <button
              type="button"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <CheckCircle
                size={16}
                weight="duotone"
                className="text-[color:var(--ds-tint-green-dot)]"
              />
              <span>{formatDate(iso)}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-[color:var(--ds-border-strong)] border-dashed px-3 py-1.5 text-muted-foreground text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40",
              )}
            >
              <Check size={15} weight="duotone" />
              <span>Marquer terminée</span>
            </button>
          )
        }
      />
      {filled ? (
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          aria-label="Retirer la date de complétion"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X size={11} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
