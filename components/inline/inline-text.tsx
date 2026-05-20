"use client";

import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { Saver } from "./types";

type Props = {
  value: string | null;
  onSave: Saver<string | null>;
  /** Texte affiché quand la valeur est vide. */
  placeholder?: string;
  /** Permet d'effacer la valeur (envoie `null`). Default: true. */
  nullable?: boolean;
  /** Limite côté client. Default: 300. */
  maxLength?: number;
  /** Mode clavier (HTML inputMode). */
  inputMode?: "text" | "numeric" | "decimal";
  /** Classe optionnelle pour adapter au contexte (titre, valeur compacte…). */
  className?: string;
  /** Format d'affichage (ex. €, %). Si fourni, appliqué uniquement en lecture. */
  format?: (raw: string | null) => string;
  /** Désactive l'édition (utile pour les viewers). */
  readOnly?: boolean;
};

export function InlineText({
  value,
  onSave,
  placeholder = "—",
  nullable = true,
  maxLength = 300,
  inputMode = "text",
  className,
  format,
  readOnly,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  // Optimistic local copy : ce qu'on affiche en lecture seule, mis à
  // jour immédiatement au commit pour éviter le flash "vieille valeur"
  // pendant que router.refresh() repropage la nouvelle prop.
  const [displayValue, setDisplayValue] = useState<string | null>(value);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Resync quand le serveur renvoie une valeur différente (router.refresh,
  // edit depuis une autre source).
  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? (nullable ? null : (value ?? "")) : trimmed;
    if ((next ?? "") === (displayValue ?? "")) {
      setEditing(false);
      return;
    }
    // Optimistic : on bascule l'affichage tout de suite ; on rollback
    // si l'action échoue.
    const prev = displayValue;
    setDisplayValue(next);
    setEditing(false);
    startTransition(async () => {
      const res = await onSave(next);
      if (!res.ok) {
        setDisplayValue(prev);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  function cancel() {
    setDraft(displayValue ?? "");
    setEditing(false);
  }

  if (readOnly || !editing) {
    const displayed = displayValue ? (format ? format(displayValue) : displayValue) : placeholder;
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
        } ${className ?? ""}`}
      >
        {displayed}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      maxLength={maxLength}
      inputMode={inputMode}
      disabled={pending}
      className={`h-8 ${className ?? ""}`}
    />
  );
}
