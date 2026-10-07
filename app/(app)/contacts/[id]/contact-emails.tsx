"use client";

import { Plus, Star, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addContactEmail,
  removeContactEmail,
  setPrimaryContactEmail,
} from "@/lib/actions/contacts";
import { demoEmail } from "@/lib/demo/anonymize";
import { useDemoMode } from "@/lib/demo/context";
import { ContEmail } from "./inline-fields";

type Row = { id: string; email: string; label: string | null };

type Props = {
  contactId: string;
  /** Adresse principale (`contacts.email`), éditable inline. */
  primary: string | null;
  /** Adresses secondaires (`contact_emails`). */
  others: Row[];
};

/**
 * Bloc « E-mail » d'une fiche contact : l'adresse principale (éditable
 * inline comme avant), puis les adresses secondaires avec, pour chacune,
 * la promotion en principale et le retrait, et un ajout en place.
 */
export function ContactEmails({ contactId, primary, others }: Props) {
  const demo = useDemoMode();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    startTransition(async () => {
      const res = await task();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = draft.trim();
    if (!email) {
      setAdding(false);
      return;
    }
    startTransition(async () => {
      const res = await addContactEmail({ contactId, email });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDraft("");
      setAdding(false);
      router.refresh();
    });
  }

  const iconButton =
    "rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <ContEmail id={contactId} value={primary} className="truncate" />
        {others.length > 0 && primary ? (
          <span className="flex-none text-[10px] text-muted-foreground uppercase tracking-wide">
            principale
          </span>
        ) : null}
      </div>

      {others.length > 0 ? (
        <ul className="space-y-0.5">
          {others.map((row) => (
            <li key={row.id} className="group flex items-center gap-1.5 text-sm">
              <span className="truncate text-muted-foreground">
                {demo ? demoEmail(row.id) : row.email}
              </span>
              {row.label ? (
                <span className="flex-none text-muted-foreground text-xs">({row.label})</span>
              ) : null}
              {demo ? null : (
                <>
                  <button
                    type="button"
                    title="Définir comme adresse principale"
                    aria-label="Définir comme adresse principale"
                    className={iconButton}
                    disabled={pending}
                    onClick={() =>
                      run(() => setPrimaryContactEmail({ contactId, email: row.email }))
                    }
                  >
                    <Star size={13} />
                  </button>
                  <button
                    type="button"
                    title="Retirer cette adresse"
                    aria-label="Retirer cette adresse"
                    className={iconButton}
                    disabled={pending}
                    onClick={() => run(() => removeContactEmail({ contactId, email: row.email }))}
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {demo ? null : adding ? (
        <form onSubmit={submitAdd} className="flex items-center gap-1.5">
          <Input
            type="email"
            // biome-ignore lint/a11y/noAutofocus: champ ouvert par un geste explicite
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="autre@adresse.fr"
            maxLength={200}
            disabled={pending}
            className="h-8 max-w-xs"
          />
          <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
            {pending ? "Ajout…" : "Ajouter"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setDraft("");
              setAdding(false);
            }}
          >
            Annuler
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
        >
          <Plus size={12} weight="bold" />
          {primary ? "Ajouter une autre adresse" : "Ajouter une adresse secondaire"}
        </button>
      )}
    </div>
  );
}
