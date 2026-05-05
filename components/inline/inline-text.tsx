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
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? (nullable ? null : (value ?? "")) : trimmed;
    if ((next ?? "") === (value ?? "")) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await onSave(next);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
  }

  if (readOnly || !editing) {
    const displayed = value ? (format ? format(value) : value) : placeholder;
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          if (readOnly) return;
          setDraft(value ?? "");
          setEditing(true);
        }}
        className={`-mx-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${
          value ? "" : "text-muted-foreground"
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
