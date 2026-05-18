"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";

type Tab = "dashboard" | "rapprochement";

export function ComptaTabs({ current }: { current: Tab }) {
  return (
    <nav className="-mb-px flex gap-1 border-b">
      <TabLink href="/compta?tab=dashboard" label="Dashboard" active={current === "dashboard"} />
      <TabLink
        href="/compta?tab=rapprochement"
        label="Rapprochement"
        active={current === "rapprochement"}
      />
    </nav>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "border-transparent border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-foreground font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
