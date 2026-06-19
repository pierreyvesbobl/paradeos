"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CalendarBlank, CaretDown, Check } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type ComptaPeriod =
  | "current_month"
  | "last_month"
  | "last_3_months"
  | "last_12_months"
  | "current_year"
  | "last_year"
  | "all";

const OPTIONS: { value: ComptaPeriod; label: string }[] = [
  { value: "current_month", label: "Mois en cours" },
  { value: "last_month", label: "Mois dernier" },
  { value: "last_3_months", label: "3 derniers mois" },
  { value: "last_12_months", label: "12 derniers mois" },
  { value: "current_year", label: "Année en cours" },
  { value: "last_year", label: "Année dernière" },
  { value: "all", label: "Tout" },
];

export function PeriodSelector({ current }: { current: ComptaPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentLabel = OPTIONS.find((o) => o.value === current)?.label ?? "Période";

  function select(value: ComptaPeriod) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "last_12_months") {
      next.delete("period");
    } else {
      next.set("period", value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border bg-[var(--ds-bg-app)] px-3 py-1.5 text-foreground text-sm transition-colors hover:bg-[var(--ds-bg-hover)]",
            pending && "opacity-60",
          )}
        >
          <CalendarBlank size={15} weight="duotone" className="text-muted-foreground" />
          {currentLabel}
          <CaretDown size={11} weight="bold" className="ml-0.5 text-[var(--ds-text-tertiary)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[210px]">
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => select(o.value)}
            className="flex items-center gap-2"
          >
            <span className="flex-1">{o.label}</span>
            {o.value === current ? (
              <Check size={13} weight="bold" className="text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
