"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { Saver } from "./types";

type Props = {
  value: string | null;
  onSave: Saver<string | null>;
  placeholder?: string;
  /** Hauteur en rangées en mode édition. Default: 5. */
  rows?: number;
  /** Limite côté client. Default: 5000. */
  maxLength?: number;
  className?: string;
};

export function InlineMultiline({
  value,
  onSave,
  placeholder = "Cliquer pour ajouter une description…",
  rows = 5,
  maxLength = 5000,
  className,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
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

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className={`block w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
      >
        {value ? (
          <p className="whitespace-pre-wrap text-sm">{value}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{placeholder}</p>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        rows={rows}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={maxLength}
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(false);
          }}
          disabled={pending}
        >
          Annuler
        </Button>
        <Button type="button" size="sm" onClick={commit} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}
