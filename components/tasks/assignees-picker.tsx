"use client";

import { AvatarStack, type StackedAssignee } from "@/components/tasks/avatar-stack";
import type { TaskContactOption, TaskUserOption } from "@/components/tasks/task-types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContactAvatar } from "@/components/user/contact-avatar";
import { UserAvatar } from "@/components/user/user-avatar";
import { cn } from "@/lib/utils";
import { Check, Plus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

export type AssigneeRef =
  | { kind: "user"; id: string; fullName: string | null; avatarUrl: string | null }
  | { kind: "contact"; id: string; fullName: string; entityName: string | null };

type Props = {
  value: AssigneeRef[];
  onChange: (next: AssigneeRef[]) => void;
  userOptions: TaskUserOption[];
  contactOptions?: TaskContactOption[];
  /** Trigger custom — par défaut, un cluster d'avatars + un "+". */
  trigger?: ReactNode;
  /** Désactive tout (en transition). */
  disabled?: boolean;
  /** Pile d'avatars rendue dans le trigger par défaut (max overlap). */
  triggerMax?: number;
};

/**
 * Multi-sélection d'assignés. Mixe membres internes (kind=user) et contacts
 * externes (kind=contact). Le clic sur un item l'ajoute/retire. Le trigger
 * par défaut affiche une pile d'avatars compacte + une case dashed "+".
 */
export function AssigneesPicker({
  value,
  onChange,
  userOptions,
  contactOptions = [],
  trigger,
  disabled,
  triggerMax = 3,
}: Props) {
  const [open, setOpen] = useState(false);

  const selectedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const a of value) set.add(`${a.kind}:${a.id}`);
    return set;
  }, [value]);

  function toggle(next: AssigneeRef) {
    const key = `${next.kind}:${next.id}`;
    if (selectedKeys.has(key)) {
      onChange(value.filter((a) => `${a.kind}:${a.id}` !== key));
    } else {
      onChange([...value, next]);
    }
  }

  function clearAll() {
    onChange([]);
  }

  const defaultTrigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label="Assignés"
      className={cn(
        "inline-flex items-center gap-1 rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
      )}
    >
      {value.length === 0 ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full border-[1.5px] border-ds-border-strong border-dashed text-ds-text-tertiary">
          <Plus className="size-[10px] stroke-[3]" />
        </span>
      ) : (
        <AvatarStack assignees={value as StackedAssignee[]} max={triggerMax} />
      )}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Membre Paradeos ou contact externe…" />
          <CommandList>
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            {value.length > 0 ? (
              <CommandGroup>
                <CommandItem onSelect={clearAll} value="__clear__">
                  <X className="size-3.5 text-ds-text-tertiary" />
                  <span className="text-ds-text-tertiary">Retirer tous les assignés</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Paradeos">
              {userOptions.map((u) => {
                const checked = selectedKeys.has(`user:${u.id}`);
                return (
                  <CommandItem
                    key={`u:${u.id}`}
                    value={`u ${u.fullName ?? u.id}`}
                    onSelect={() =>
                      toggle({
                        kind: "user",
                        id: u.id,
                        fullName: u.fullName,
                        avatarUrl: u.avatarUrl,
                      })
                    }
                  >
                    <UserAvatar size="sm" name={u.fullName} avatarUrl={u.avatarUrl} />
                    <span className="truncate">{u.fullName ?? "(sans nom)"}</span>
                    {checked ? <Check className="ml-auto size-3.5" /> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {contactOptions.length > 0 ? (
              <CommandGroup heading="Externes">
                {contactOptions.map((c) => {
                  const checked = selectedKeys.has(`contact:${c.id}`);
                  return (
                    <CommandItem
                      key={`c:${c.id}`}
                      value={`c ${c.fullName} ${c.entityName ?? ""}`}
                      onSelect={() =>
                        toggle({
                          kind: "contact",
                          id: c.id,
                          fullName: c.fullName,
                          entityName: c.entityName,
                        })
                      }
                    >
                      <ContactAvatar size="sm" name={c.fullName} entityName={c.entityName} />
                      <span className="truncate">
                        {c.fullName}
                        {c.entityName ? (
                          <span className="text-ds-text-tertiary"> — {c.entityName}</span>
                        ) : null}
                      </span>
                      {checked ? <Check className="ml-auto size-3.5" /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
