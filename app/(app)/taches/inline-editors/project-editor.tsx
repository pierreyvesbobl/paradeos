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
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Option = { id: string; name: string };

export function TaskProjectEditor({
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
          className="rounded-sm px-1.5 py-0.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value ? (
            <span className="hover:underline">{value.name}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Rechercher un projet…" />
          <CommandList>
            <CommandEmpty>Aucun projet.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => pick(null)} value="__aucun__">
                <X className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Aucun projet</span>
                {value === null ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem key={opt.id} value={opt.name} onSelect={() => pick(opt.id)}>
                  <span>{opt.name}</span>
                  {opt.id === value?.id ? <Check className="ml-auto size-3.5" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
