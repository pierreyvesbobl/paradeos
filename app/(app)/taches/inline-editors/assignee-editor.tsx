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

type UserOption = { id: string; fullName: string | null; avatarUrl: string | null };
type ContactOption = { id: string; fullName: string; entityName?: string | null };

export type AssigneeValue =
  | { kind: "user"; id: string; fullName: string | null; avatarUrl: string | null }
  | { kind: "contact"; id: string; fullName: string; entityName: string | null }
  | null;

export function TaskAssigneeEditor({
  id,
  value,
  options,
  contactOptions,
}: {
  id: string;
  value: AssigneeValue;
  options: UserOption[];
  contactOptions?: ContactOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pickUser(next: string | null) {
    const current = value?.kind === "user" ? value.id : null;
    if ((next ?? null) === current && value?.kind !== "contact") {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await patchTask({ id, assigneeId: next, assigneeContactId: null });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function pickContact(next: string) {
    if (value?.kind === "contact" && value.id === next) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await patchTask({ id, assigneeId: null, assigneeContactId: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const triggerLabel = () => {
    if (!value) return <span className="px-1.5 text-muted-foreground text-sm">—</span>;
    if (value.kind === "user") {
      return <UserAvatar size="sm" name={value.fullName} avatarUrl={value.avatarUrl} />;
    }
    return (
      <span
        className="inline-flex h-6 items-center gap-1 rounded-full bg-amber-100 px-1.5 font-medium text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        title={`${value.fullName}${value.entityName ? ` — ${value.entityName}` : ""} (externe)`}
      >
        {value.fullName
          .split(" ")
          .map((p) => p[0]?.toUpperCase() ?? "")
          .join("")
          .slice(0, 2) || "?"}
      </span>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {triggerLabel()}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Membre Paradeos ou contact externe…" />
          <CommandList>
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => pickUser(null)} value="__aucun__">
                <X className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Non assignée</span>
                {value === null ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Paradeos">
              {options.map((opt) => (
                <CommandItem
                  key={`u:${opt.id}`}
                  value={`u ${opt.fullName ?? opt.id}`}
                  onSelect={() => pickUser(opt.id)}
                >
                  <UserAvatar size="sm" name={opt.fullName} avatarUrl={opt.avatarUrl} />
                  <span>{opt.fullName ?? "(sans nom)"}</span>
                  {value?.kind === "user" && opt.id === value.id ? (
                    <Check className="ml-auto size-3.5" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {contactOptions && contactOptions.length > 0 ? (
              <CommandGroup heading="Externes">
                {contactOptions.map((opt) => (
                  <CommandItem
                    key={`c:${opt.id}`}
                    value={`c ${opt.fullName} ${opt.entityName ?? ""}`}
                    onSelect={() => pickContact(opt.id)}
                  >
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 font-medium text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      {opt.fullName
                        .split(" ")
                        .map((p) => p[0]?.toUpperCase() ?? "")
                        .join("")
                        .slice(0, 2) || "?"}
                    </span>
                    <span className="truncate">
                      {opt.fullName}
                      {opt.entityName ? (
                        <span className="text-muted-foreground"> — {opt.entityName}</span>
                      ) : null}
                    </span>
                    {value?.kind === "contact" && opt.id === value.id ? (
                      <Check className="ml-auto size-3.5" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
