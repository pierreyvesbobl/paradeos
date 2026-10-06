"use client";

import { Input } from "@/components/ui/input";
import { lookupAddresses } from "@/lib/actions/gouv";
import type { AddressSuggestion } from "@/lib/gouv/adresse";
import { cn } from "@/lib/utils";
import { MapPin } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

type Props = {
  id?: string;
  /** Valeur du champ Rue, pilotée par le formulaire. */
  value: string;
  onChange: (value: string) => void;
  /** Appelé quand une suggestion BAN est choisie : code postal, ville, pays. */
  onPick: (address: AddressSuggestion["address"]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Édition inline : le champ prend le focus à l'ouverture. */
  autoFocus?: boolean;
  /** Entrée sans suggestion survolée — l'appelant valide sa saisie. */
  onCommit?: () => void;
  /** Échap une fois la liste fermée — l'appelant annule son édition. */
  onCancel?: () => void;
  /** Perte de focus, après fermeture de la liste. */
  onBlur?: () => void;
};

/**
 * Champ « Rue » avec suggestions de la Base Adresse Nationale. La saisie
 * libre reste la règle — les suggestions ne sont qu'un raccourci, et une
 * adresse étrangère ou un lieu-dit absent de la BAN se tape à la main.
 *
 * Une liste déroulante maison plutôt qu'un Popover Radix : le champ doit
 * rester éditable au clavier pendant que les suggestions s'affichent, ce
 * qu'un Popover modal rend inconfortable.
 */
export function AddressAutocomplete({
  id,
  value,
  onChange,
  onPick,
  placeholder,
  disabled = false,
  className,
  autoFocus = false,
  onCommit,
  onCancel,
  onBlur,
}: Props) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Garde anti-course : une réponse lente ne doit pas écraser une plus récente.
  const requestId = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * La recherche part de la frappe, jamais de la prop `value`. Sinon une
   * adresse posée par le code — le préremplissage INSEE, typiquement —
   * déclencherait la BAN et proposerait d'écraser un code postal et une
   * ville déjà justes.
   */
  function scheduleSearch(next: string) {
    if (timer.current) clearTimeout(timer.current);
    // Incrémenté même sur une requête non lancée : annule celles en vol.
    const id = ++requestId.current;
    const q = next.trim();
    if (q.length < 4) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const res = await lookupAddresses({ query: q });
      if (id !== requestId.current) return;
      if (!res.ok) {
        // Échec silencieux : la saisie manuelle reste possible, inutile
        // d'alerter l'utilisateur parce que la BAN a toussé.
        setSuggestions([]);
        setOpen(false);
        return;
      }
      setSuggestions(res.data);
      setActive(-1);
      setOpen(res.data.length > 0);
    }, 300);
  }

  function handleChange(next: string) {
    onChange(next);
    scheduleSearch(next);
  }

  function choose(suggestion: AddressSuggestion) {
    onChange(suggestion.address.street ?? "");
    onPick(suggestion.address);
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Tant que la liste est ouverte, elle capte les touches. Une fois
    // fermée, elles reviennent à l'appelant : c'est ce qui permet au
    // premier Échap de fermer les suggestions et au second d'annuler
    // l'édition inline.
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === "Enter" && active >= 0) {
        // Ne pas soumettre le formulaire : l'Entrée valide la suggestion.
        e.preventDefault();
        const picked = suggestions[active];
        if (picked) choose(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
        return;
      }
    }
    if (e.key === "Enter" && onCommit) {
      e.preventDefault();
      onCommit();
      return;
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        // Laisser le temps au clic sur une suggestion d'aboutir. Le clic
        // lui-même passe par `mousedown` + `preventDefault`, donc il ne
        // déclenche pas ce blur.
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        onFocus={() => setOpen(suggestions.length > 0)}
        placeholder={placeholder}
        disabled={disabled}
        // Focus à l'ouverture en édition inline : le clic sur la valeur
        // vaut intention d'éditer, le champ doit être prêt à recevoir.
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        // Le focus reste dans le champ : c'est `aria-activedescendant` qui
        // indique au lecteur d'écran la suggestion survolée (motif ARIA 1.2).
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
      />
      {open && suggestions.length > 0 ? (
        <div
          id={listId}
          // biome-ignore lint/a11y/useSemanticElements: un <select> ne peut pas
          // afficher deux lignes par option, et le motif combobox ARIA impose
          // une listbox distincte du champ de saisie.
          role="listbox"
          tabIndex={-1}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.id}
              id={`${listId}-${index}`}
              // biome-ignore lint/a11y/useSemanticElements: idem — <option> ne
              // rend pas de contenu riche. Le focus ne quitte jamais l'input,
              // d'où le tabIndex négatif et la sélection à la souris/clavier.
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseDown={(e) => {
                // `mousedown` plutôt que `click` : le blur de l'input
                // fermerait la liste avant que le clic n'arrive.
                e.preventDefault();
                choose(suggestion);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                index === active ? "bg-accent text-accent-foreground" : "",
              )}
            >
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{suggestion.label}</span>
                {suggestion.context ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {suggestion.context}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
