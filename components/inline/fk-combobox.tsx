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
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

type Option = {
  id: string;
  label: string;
  /** Valeur indexée pour la recherche cmdk. Default: label. */
  searchValue?: string;
  /** Visuel optionnel rendu avant le label dans la liste (et le déclencheur). */
  leading?: ReactNode;
};

type Props = {
  /** Id sélectionné, ou `null` (aucun). */
  value: string | null;
  onValueChange: (value: string | null) => void;
  options: Option[];
  id?: string;
  placeholder?: string;
  /** Texte de placeholder de la zone de recherche cmdk. */
  searchPlaceholder?: string;
  /** Texte de la ligne « Aucun ». Mettre à null pour ne pas la proposer. */
  clearLabel?: string | null;
  /** Texte affiché quand aucune option ne correspond. */
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Si fourni, un item "Créer « X »" apparaît dans la liste quand la
   * recherche ne matche pas une option existante. Doit créer le record
   * en base et retourner son `{ id, label }`. Le picker l'auto-sélectionne
   * derrière via `onValueChange`.
   */
  onCreate?: (query: string) => Promise<{ id: string; label: string } | null>;
  /** Préfixe affiché dans l'item de création (defaut: "Créer"). */
  createLabel?: string;
};

export function FkCombobox({
  value,
  onValueChange,
  options,
  id,
  placeholder = "—",
  searchPlaceholder = "Rechercher…",
  clearLabel = "Aucun",
  emptyLabel = "Aucun résultat.",
  disabled = false,
  className,
  onCreate,
  createLabel = "Créer",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = options.find((o) => o.id === value) ?? null;

  function pick(next: string | null) {
    onValueChange(next);
    setOpen(false);
    setSearch("");
  }

  async function handleCreate(query: string) {
    if (!onCreate) return;
    setCreating(true);
    try {
      const created = await onCreate(query);
      if (!created) {
        toast.error("Création impossible.");
        return;
      }
      onValueChange(created.id);
      setOpen(false);
      setSearch("");
      toast.success(`« ${created.label} » créé et sélectionné.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Création échouée.");
    } finally {
      setCreating(false);
    }
  }

  const trimmed = search.trim();
  const showCreate =
    !!onCreate &&
    trimmed.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled || creating}
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {selected ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              {selected.leading}
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-72 p-0">
        <Command
          filter={(value, q) => {
            // cmdk par défaut est case-insensitive mais accent-sensitive.
            // Normalisation NFD pour matcher "Bénédicte" avec "benedicte".
            if (!q) return 1;
            const strip = (s: string) =>
              s
                .toLowerCase()
                .normalize("NFD")
                .replace(/\p{Diacritic}/gu, "");
            return strip(value).includes(strip(q)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {showCreate ? (
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => handleCreate(trimmed)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <Plus className="size-3.5" />
                  {createLabel} « {trimmed} »
                </button>
              ) : (
                <span className="text-muted-foreground text-sm">{emptyLabel}</span>
              )}
            </CommandEmpty>
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
                  <span className="truncate">{opt.label}</span>
                  {opt.id === value ? <Check className="ml-auto size-3.5" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {showCreate ? (
              <CommandGroup heading="Créer">
                <CommandItem value={`__create__${trimmed}`} onSelect={() => handleCreate(trimmed)}>
                  <Plus className="size-3.5" />
                  <span>
                    {createLabel} « <strong>{trimmed}</strong> »
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
