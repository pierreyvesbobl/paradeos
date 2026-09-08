"use client";

import { cn } from "@/lib/utils";
import { ClockCounterClockwise, ListChecks } from "@phosphor-icons/react";
import Link from "next/link";

export type InboxTab = "a-traiter" | "historique";

/**
 * Deux moments d'un même flux : décider, puis retrouver ce qu'on a
 * décidé pour le corriger.
 */
export function InboxTabs({ current, pendingCount }: { current: InboxTab; pendingCount: number }) {
  const tabs = [
    {
      key: "a-traiter" as const,
      href: "/inbox",
      label: "À traiter",
      icon: ListChecks,
      badge: pendingCount,
    },
    {
      key: "historique" as const,
      href: "/inbox?vue=historique",
      label: "Historique",
      icon: ClockCounterClockwise,
      badge: 0,
    },
  ];

  return (
    <nav className="-mb-px flex gap-6 border-b">
      {tabs.map(({ key, href, label, icon: Icon, badge }) => {
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
            {badge > 0 ? (
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 font-semibold text-[10px]"
                style={{
                  background: "var(--ds-tint-orange-bg)",
                  color: "var(--ds-tint-orange-text)",
                }}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
