"use client";

import { cn } from "@/lib/utils";
import { Briefcase, Buildings, Stack } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { ComptaSegment } from "./dashboard-view";

const OPTIONS: { value: ComptaSegment; label: string; icon: typeof Stack }[] = [
  { value: "conso", label: "Consolidé", icon: Stack },
  { value: "presta", label: "Presta", icon: Briefcase },
  { value: "cowork", label: "Coworking", icon: Buildings },
];

export function ComptaSegmentSwitcher({ current }: { current: ComptaSegment }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(value: ComptaSegment) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "conso") {
      next.delete("segment");
    } else {
      next.set("segment", value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border bg-[var(--ds-bg-surface)] p-0.5",
        pending && "opacity-60",
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = value === current;
        return (
          <button
            key={value}
            type="button"
            disabled={pending}
            onClick={() => select(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] transition-colors",
              active
                ? "bg-[var(--ds-bg-app)] font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={14} weight="duotone" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
