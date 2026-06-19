"use client";

import { cn } from "@/lib/utils";
import { CalendarDots, ChartBar } from "@phosphor-icons/react";
import Link from "next/link";

type Tab = "planning" | "rapport";

const TABS: { key: Tab; href: string; label: string; icon: typeof CalendarDots }[] = [
  { key: "planning", href: "/temps?tab=planning", label: "Planning", icon: CalendarDots },
  { key: "rapport", href: "/temps?tab=rapport", label: "Rapport", icon: ChartBar },
];

export function TempsTabs({ current }: { current: Tab }) {
  return (
    <nav className="-mb-px flex gap-6 border-b">
      {TABS.map(({ key, href, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={href}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-0.5 pb-3 text-sm transition-colors",
              active
                ? "border-foreground font-semibold text-foreground"
                : "border-transparent font-medium text-[var(--ds-text-tertiary)] hover:text-foreground",
            )}
          >
            <Icon size={16} weight="duotone" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
