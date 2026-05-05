"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { Saver } from "./types";

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  options: readonly Option<T>[];
  onSave: Saver<T>;
  /** Custom render du déclencheur (badge typé ex.). */
  trigger?: (current: Option<T> | undefined) => ReactNode;
};

export function InlineSelect<T extends string>({ value, options, onSave, trigger }: Props<T>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = options.find((o) => o.value === value);

  function pick(next: T) {
    if (next === value) {
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="-mx-1.5 cursor-pointer rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {trigger ? trigger(current) : <span>{current?.label ?? "—"}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <ul className="space-y-0.5">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => pick(opt.value)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span>{opt.label}</span>
                {opt.value === value ? <Check className="size-3.5" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
