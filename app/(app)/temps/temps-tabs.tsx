"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";

type Tab = "planning" | "rapport";

export function TempsTabs({ current }: { current: Tab }) {
  return (
    <nav className="-mb-px flex gap-1 border-b">
      <TabLink href="/temps?tab=planning" label="Planning" active={current === "planning"} />
      <TabLink href="/temps?tab=rapport" label="Rapport" active={current === "rapport"} />
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
