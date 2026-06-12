"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";

type Tab = "contacts" | "entites" | "pipeline";

export function CrmTabs({ current }: { current: Tab }) {
  return (
    <nav className="-mb-px flex gap-1 border-b">
      <TabLink href="/crm/contacts" label="Contacts" active={current === "contacts"} />
      <TabLink href="/crm/entites" label="Entités" active={current === "entites"} />
      <TabLink href="/crm/pipeline" label="Pipeline" active={current === "pipeline"} />
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
