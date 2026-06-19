"use client";

import { cn } from "@/lib/utils";
import { FileText, Gauge, Link as LinkIcon } from "@phosphor-icons/react";
import Link from "next/link";

type Tab = "dashboard" | "rapprochement" | "factures";

const TABS: { key: Tab; href: string; label: string; icon: typeof Gauge }[] = [
  { key: "dashboard", href: "/compta?tab=dashboard", label: "Vue d'ensemble", icon: Gauge },
  {
    key: "rapprochement",
    href: "/compta?tab=rapprochement",
    label: "Rapprochement",
    icon: LinkIcon,
  },
  { key: "factures", href: "/compta?tab=factures", label: "Factures", icon: FileText },
];

export function ComptaTabs({ current }: { current: Tab }) {
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
