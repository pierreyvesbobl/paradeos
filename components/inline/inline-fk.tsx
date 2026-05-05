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
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import type { Saver } from "./types";

type Option = {
  id: string;
  label: string;
  /** Valeur indexée pour la recherche cmdk. Default: label. */
  searchValue?: string;
  /** Visuel optionnel rendu avant le label dans la liste (et le déclencheur). */
  leading?: ReactNode;
};

type Props = {
  value: { id: string; label: string; leading?: ReactNode } | null;
  options: Option[];
  onSave: Saver<string | null>;
  placeholder?: string;
  /** Texte de placeholder de la zone de recherche cmdk. */
  searchPlaceholder?: string;
  /** Texte de la ligne « Aucun ». Mettre à null pour ne pas la proposer. */
  clearLabel?: string | null;
  /** Texte affiché quand aucune option ne correspond. */
  emptyLabel?: string;
  /**
   * Apparence du déclencheur :
   * - "default" : texte du label (avec `leading` éventuel à gauche).
   * - "leading-only" : seul `value.leading` est affiché (pas de label).
   */
  triggerVariant?: "default" | "leading-only";
};

export function InlineFk({
  value,
  options,
  onSave,
  placeholder = "—",
  searchPlaceholder = "Rechercher…",
  clearLabel = "Aucun",
  emptyLabel = "Aucun résultat.",
  triggerVariant = "default",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pick(next: string | null) {
    if ((next ?? null) === (value?.id ?? null)) {
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
          className={cn(
            "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            triggerVariant === "leading-only"
              ? "rounded-full hover:opacity-80"
              : "-mx-1.5 rounded-sm px-1.5 py-0.5 text-left hover:bg-muted",
          )}
        >
          {triggerVariant === "leading-only" ? (
            (value?.leading ?? <span className="text-muted-foreground">{placeholder}</span>)
          ) : value ? (
            <span className="inline-flex items-center gap-1.5">
              {value.leading}
              <span>{value.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {clearLabel !== null ? (
                <CommandItem onSelect={() => pick(null)} value="__aucun__">
                  <X className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{clearLabel}</span>
                  {value === null ? <Check className="ml-auto size-3.5" /> : null}
                </CommandItem>
              ) : null}
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={opt.searchValue ?? opt.label}
                  onSelect={() => pick(opt.id)}
                >
                  {opt.leading ? (
                    <span className="inline-flex shrink-0 items-center">{opt.leading}</span>
                  ) : null}
                  <span>{opt.label}</span>
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
