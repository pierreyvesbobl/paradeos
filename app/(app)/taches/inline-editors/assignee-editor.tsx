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
import { UserAvatar } from "@/components/user/user-avatar";
import { patchTask } from "@/lib/actions/tasks";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Option = { id: string; fullName: string | null; avatarUrl: string | null };

export function TaskAssigneeEditor({
  id,
  value,
  options,
}: {
  id: string;
  value: { id: string; fullName: string | null; avatarUrl: string | null } | null;
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
      const res = await patchTask({ id, assigneeId: next });
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
          className="rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {value ? (
            <UserAvatar size="sm" name={value.fullName} avatarUrl={value.avatarUrl} />
          ) : (
            <span className="px-1.5 text-muted-foreground text-sm">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Rechercher un membre…" />
          <CommandList>
            <CommandEmpty>Aucun membre.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => pick(null)} value="__aucun__">
                <X className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Non assignée</span>
                {value === null ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={opt.fullName ?? opt.id}
                  onSelect={() => pick(opt.id)}
                >
                  <UserAvatar size="sm" name={opt.fullName} avatarUrl={opt.avatarUrl} />
                  <span>{opt.fullName ?? "(sans nom)"}</span>
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
