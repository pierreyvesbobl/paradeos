"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addProjectContact, removeProjectContact } from "@/lib/actions/project-members";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Contact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

function contactLabel(c: Contact): string {
  const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  return name || c.email || "(sans nom)";
}

/**
 * Chips multi-select pour les contacts CRM liés à un projet, en plus
 * du `contact_id` primaire de la table projects.
 */
export function ProjectContactsField({
  projectId,
  contacts,
  options,
  primaryContactId,
}: {
  projectId: string;
  contacts: Contact[];
  options: Contact[];
  /** Contact primaire du projet, exclu du picker (déjà géré ailleurs). */
  primaryContactId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const linkedIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !linkedIds.has(o.id) && o.id !== primaryContactId)
      .filter((o) => (q ? contactLabel(o).toLowerCase().includes(q) : true))
      .slice(0, 30);
  }, [options, linkedIds, primaryContactId, query]);

  function add(contactId: string) {
    startTransition(async () => {
      const res = await addProjectContact({ projectId, contactId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(contactId: string) {
    startTransition(async () => {
      const res = await removeProjectContact({ projectId, contactId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {contacts.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2 text-xs"
            >
              <Link
                href={`/contacts/${c.id}`}
                className="max-w-[140px] truncate hover:underline"
                title={c.email ?? undefined}
              >
                {contactLabel(c)}
              </Link>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={pending}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                aria-label={`Retirer ${contactLabel(c)}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" />
            Ajouter
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-1 p-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un contact…"
            disabled={pending}
            className="w-full rounded-sm bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:bg-muted/50"
          />
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-1.5 py-1 text-[11px] text-muted-foreground italic">
                Aucun contact disponible
              </li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => add(o.id)}
                    disabled={pending}
                    className="flex w-full flex-col items-start gap-0 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <span className="truncate font-medium">{contactLabel(o)}</span>
                    {o.email ? (
                      <span className="truncate text-[10px] text-muted-foreground">{o.email}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
