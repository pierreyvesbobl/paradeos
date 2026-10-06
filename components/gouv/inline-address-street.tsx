"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/gouv/address-autocomplete";
import type { SaveResult } from "@/components/inline/types";
import type { EntityAddress } from "@/db/schema/entities";

type Props = {
  /** Rue courante. */
  value: string | null;
  /** Saisie libre validée : n'écrit que la rue. */
  onSaveStreet: (street: string | null) => Promise<SaveResult>;
  /** Suggestion BAN choisie : écrit rue, code postal, ville et pays d'un coup. */
  onSaveAddress: (address: EntityAddress) => Promise<SaveResult>;
  placeholder?: string;
  readOnly?: boolean;
};

/**
 * Même ergonomie que `InlineText` — cliquer pour éditer, Entrée valide,
 * Échap annule — mais le champ propose les adresses de la Base Adresse
 * Nationale. Choisir une suggestion renseigne l'adresse entière, pas
 * seulement la rue : c'est tout l'intérêt, le code postal et la ville
 * voisins n'ont plus à être corrigés à la main derrière.
 */
export function InlineAddressStreet({
  value,
  onSaveStreet,
  onSaveAddress,
  placeholder = "Rue",
  readOnly,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  // Copie optimiste : évite le flash « vieille valeur » pendant que
  // `router.refresh()` repropage la prop.
  const [displayValue, setDisplayValue] = useState<string | null>(value);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  function run(next: string | null, save: () => Promise<SaveResult>) {
    const previous = displayValue;
    setDisplayValue(next);
    setEditing(false);
    startTransition(async () => {
      const res = await save();
      if (!res.ok) {
        setDisplayValue(previous);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  function commit() {
    // Le blur peut arriver après qu'une suggestion a déjà clos l'édition :
    // sans cette garde, il réécrirait la rue tapée par-dessus l'adresse choisie.
    if (!editing) return;
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if ((next ?? "") === (displayValue ?? "")) {
      setEditing(false);
      return;
    }
    run(next, () => onSaveStreet(next));
  }

  function pick(address: EntityAddress) {
    run(address.street ?? null, () => onSaveAddress(address));
  }

  function cancel() {
    setDraft(displayValue ?? "");
    setEditing(false);
  }

  if (readOnly || !editing) {
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          if (readOnly) return;
          setDraft(displayValue ?? "");
          setEditing(true);
        }}
        className={`-mx-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${
          displayValue ? "" : "text-muted-foreground"
        }`}
      >
        {displayValue ?? placeholder}
      </button>
    );
  }

  return (
    <AddressAutocomplete
      value={draft}
      onChange={setDraft}
      onPick={pick}
      onCommit={commit}
      onCancel={cancel}
      onBlur={commit}
      placeholder={placeholder}
      disabled={pending}
      autoFocus
      className="w-full"
    />
  );
}
