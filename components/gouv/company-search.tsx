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
import { lookupCompanies } from "@/lib/actions/gouv";
import type { SireneCompany } from "@/lib/gouv/sirene";
import { cn } from "@/lib/utils";
import { Buildings, MagnifyingGlass, Warning } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  /** Appelé avec la fiche INSEE choisie. À charge de l'appelant de préremplir. */
  onPick: (company: SireneCompany) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Recherche dans l'annuaire des entreprises (INSEE Sirene + RNE) par nom,
 * SIREN ou SIRET. Ne remplit rien tout seul : renvoie la fiche choisie à
 * l'appelant, qui décide des champs à écraser.
 *
 * Le filtrage est désactivé côté cmdk (`shouldFilter={false}`) : c'est
 * l'INSEE qui classe, pas nous.
 */
export function CompanySearch({ onPick, disabled = false, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SireneCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Garde anti-course : une réponse lente ne doit pas écraser une plus récente.
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const res = await lookupCompanies({ query: q });
      if (id !== requestId.current) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.message);
        setResults([]);
        return;
      }
      setError(null);
      setResults(res.data);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function pick(company: SireneCompany) {
    onPick(company);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border border-input border-dashed bg-transparent px-3 py-2 text-left text-muted-foreground text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <MagnifyingGlass className="size-4 shrink-0" />
          <span className="truncate">Chercher dans l'annuaire des entreprises…</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Nom, SIREN ou SIRET…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              <span className="text-muted-foreground text-sm">
                {query.trim().length < 3
                  ? "Tape au moins 3 caractères."
                  : loading
                    ? "Recherche…"
                    : (error ?? "Aucune entreprise trouvée.")}
              </span>
            </CommandEmpty>
            {results.length > 0 ? (
              <CommandGroup heading="Annuaire des entreprises">
                {results.map((company) => (
                  <CommandItem
                    key={`${company.siren}-${company.siret ?? ""}`}
                    value={company.siren}
                    onSelect={() => pick(company)}
                    className="items-start gap-2"
                  >
                    <Buildings className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{company.name}</span>
                        {!company.active ? (
                          <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            Cessée
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {company.siren}
                        {company.addressLabel ? ` · ${company.addressLabel}` : ""}
                      </span>
                      {company.undisclosed ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Warning className="size-3 shrink-0" />
                          Adresse non diffusible par l'INSEE
                        </span>
                      ) : null}
                    </span>
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
