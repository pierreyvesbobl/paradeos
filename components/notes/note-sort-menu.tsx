"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NoteSortField } from "@/lib/db/queries/notes";
import { NOTE_SORT_GROUPS, NOTE_SORT_OPTIONS } from "@/lib/notes/sort-options";
import { cn } from "@/lib/utils";
import { ArrowDownAZ, ArrowDownUp, ArrowUpAZ, Check, ChevronDown } from "lucide-react";
import Link from "next/link";

type Props = {
  current: { field: NoteSortField; dir: "asc" | "desc" };
  /** Map `${field}:${dir}` → href, précalculée côté serveur. */
  hrefs: Record<string, string>;
};

export function NoteSortMenu({ current, hrefs }: Props) {
  const active =
    NOTE_SORT_OPTIONS.find((o) => o.field === current.field && o.dir === current.dir) ??
    NOTE_SORT_OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
          title="Tri"
        >
          <ArrowDownUp className="size-3.5 text-muted-foreground" />
          <span>Trier : </span>
          <span className="font-medium">{active?.label ?? "Plus récent"}</span>
          <ChevronDown className="size-3.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {NOTE_SORT_GROUPS.map((group, gi) => (
          <div key={group.heading}>
            {gi > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[11px] text-muted-foreground uppercase tracking-wider">
              {group.heading}
            </DropdownMenuLabel>
            {group.items.map((opt) => {
              const isActive = opt.field === current.field && opt.dir === current.dir;
              const Icon = opt.dir === "asc" ? ArrowUpAZ : ArrowDownAZ;
              const href = hrefs[`${opt.field}:${opt.dir}`] ?? "/notes";
              return (
                <DropdownMenuItem key={`${opt.field}-${opt.dir}`} asChild>
                  <Link href={href} className={cn(isActive && "bg-accent")}>
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span className="flex-1">{opt.label}</span>
                    {isActive ? <Check className="size-3.5" /> : null}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
