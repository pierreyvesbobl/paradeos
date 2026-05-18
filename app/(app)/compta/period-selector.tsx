"use client";

import { cn } from "@/lib/utils";
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
    <div className="flex flex-wrap gap-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={pending}
          onClick={() => select(o.value)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs transition-colors",
            current === o.value
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
            pending && "opacity-60",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
