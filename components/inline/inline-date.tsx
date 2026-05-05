"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { Saver } from "./types";

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  return value.toISOString().slice(0, 10);
}

type Props = {
  value: Date | string | null;
  onSave: Saver<string | null>;
  placeholder?: string;
};

export function InlineDate({ value, onSave, placeholder = "—" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initial = toIso(value);
  const [draft, setDraft] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();

  function commit(next: string | null) {
    if ((next ?? null) === (initial ?? null)) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await onSave(next);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(initial ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="-mx-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value ? (
            <span>{formatDate(value)}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto space-y-2 p-3">
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => commit(null)}
            disabled={pending}
          >
            Effacer
          </Button>
          <Button type="button" size="sm" onClick={() => commit(draft || null)} disabled={pending}>
            Valider
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
