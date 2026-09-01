"use client";

import { cn } from "@/lib/utils";
import { BellRinging, FileText, Gauge, Link as LinkIcon, Receipt } from "@phosphor-icons/react";
import Link from "next/link";

type Tab = "dashboard" | "rapprochement" | "factures" | "achats" | "relances";

const TABS: { key: Tab; href: string; label: string; icon: typeof Gauge }[] = [
  { key: "dashboard", href: "/compta?tab=dashboard", label: "Vue d'ensemble", icon: Gauge },
  {
    key: "rapprochement",
    href: "/compta?tab=rapprochement",
    label: "Rapprochement",
    icon: LinkIcon,
  },
  { key: "factures", href: "/compta?tab=factures", label: "Factures", icon: FileText },
  { key: "achats", href: "/compta?tab=achats", label: "Achats", icon: Receipt },
  { key: "relances", href: "/compta?tab=relances", label: "Relances", icon: BellRinging },
];

export function ComptaTabs({
  current,
  relancesCount,
}: {
  current: Tab;
  /** Nombre de factures en retard, affiché en pastille à côté de "Relances". */
  relancesCount?: number;
}) {
  return (
    <nav className="-mb-px flex gap-6 border-b">
      {TABS.map(({ key, href, label, icon: Icon }) => {
        const active = key === current;
        const showBadge = key === "relances" && relancesCount && relancesCount > 0;
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
            {showBadge ? (
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 font-semibold text-[10px]"
                style={{
                  background: "var(--ds-tint-orange-bg)",
                  color: "var(--ds-tint-orange-text)",
                }}
              >
                {relancesCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
