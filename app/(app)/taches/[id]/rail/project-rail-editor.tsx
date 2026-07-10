"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchTask } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Option = { id: string; name: string };

/**
 * Variante rail : trigger boxed style input (hairline, radius 8,
 * bg-app, padding 9/12) plutôt que texte compact.
 */
export function TaskProjectRailEditor({
  id,
  value,
  options,
}: {
  id: string;
  value: { id: string; name: string } | null;
  options: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pick(next: string | null) {
    if ((next ?? null) === (value?.id ?? null)) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await patchTask({ id, projectId: next });
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
          className={cn(
            "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-left text-foreground text-sm outline-none hover:border-[color:var(--ds-border-strong)] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
            !value && "text-muted-foreground",
          )}
        >
          {value ? value.name : "Aucun projet"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Rechercher un projet…" />
          <CommandList>
            <CommandEmpty>Aucun projet.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => pick(null)} value="__aucun__">
                <X className="size-3.5 text-muted-foreground" weight="bold" />
                <span className="text-muted-foreground">Aucun projet</span>
                {value === null ? <Check className="ml-auto size-3.5" weight="bold" /> : null}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem key={opt.id} value={opt.name} onSelect={() => pick(opt.id)}>
                  <span>{opt.name}</span>
                  {opt.id === value?.id ? (
                    <Check className="ml-auto size-3.5" weight="bold" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
