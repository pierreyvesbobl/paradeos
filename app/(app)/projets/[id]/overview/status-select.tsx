"use client";

import { statusTone } from "@/app/(app)/projets/[id]/overview/status-pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchProject } from "@/lib/actions/projects";
import {
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  type ProjectStatus,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";
import { CaretDown, Check } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const GROUPS: { label: string; statuses: ProjectStatus[] }[] = [
  { label: "Commercial", statuses: COMMERCIAL_STATUSES },
  { label: "Delivery", statuses: DELIVERY_STATUSES },
];

type Props = {
  projectId: string;
  status: ProjectStatus;
  /**
   * `inline` — texte + caret, pour un fond déjà tinté (bannière Statut).
   * `pill` — pastille tintée autonome, pour le header de page.
   */
  appearance?: "inline" | "pill";
  className?: string;
};

/**
 * Sélecteur de statut projet : n'importe quel statut (commercial ou delivery)
 * est atteignable, là où `ProjectTransitionButtons` ne propose que les
 * transitions du happy path.
 */
export function ProjectStatusSelect({
  projectId,
  status,
  appearance = "inline",
  className,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic — le label bascule tout de suite, le reste de la page suit au refresh.
  const [displayValue, setDisplayValue] = useState(status);
  useEffect(() => setDisplayValue(status), [status]);

  function pick(next: ProjectStatus) {
    if (next === displayValue) {
      setOpen(false);
      return;
    }
    const prev = displayValue;
    setDisplayValue(next);
    setOpen(false);
    startTransition(async () => {
      const res = await patchProject({ id: projectId, status: next });
      if (!res.ok) {
        setDisplayValue(prev);
        toast.error(res.message);
        return;
      }
      toast.success(`Statut : ${projectStatusLabels[next]}.`);
      router.refresh();
    });
  }

  const tone = statusTone(displayValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Changer le statut du projet"
          className={cn(
            "inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60",
            appearance === "pill"
              ? cn("px-2.5 py-1.5 font-medium text-[13px]", tone.bg, tone.text)
              : cn(
                  "-mx-1.5 px-1.5 py-0.5 font-medium text-[14px] hover:bg-foreground/5",
                  tone.text,
                ),
            className,
          )}
        >
          {appearance === "pill" ? (
            <span className={cn("size-[7px] rounded-full", tone.dot)} />
          ) : null}
          <span>{projectStatusLabels[displayValue]}</span>
          <CaretDown size={10} weight="bold" className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {GROUPS.map((group, i) => (
          <div key={group.label} className={i > 0 ? "mt-1.5 border-ds-border border-t pt-1.5" : ""}>
            <p className="px-2.5 py-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.statuses.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => pick(opt)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className={cn("size-2.5 rounded-full", statusTone(opt).dot)} />
                    <span className="flex-1 text-left">{projectStatusLabels[opt]}</span>
                    {opt === displayValue ? (
                      <Check size={12} weight="bold" className="text-primary" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
