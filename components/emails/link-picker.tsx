"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { linkThreadToSubject } from "@/lib/actions/gmail";
import { Link2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type ProjectOpt = { id: string; name: string };
type ContactOpt = { id: string; label: string };
type EntityOpt = { id: string; name: string };
type Kind = "project" | "contact" | "entity";

type Props = {
  threadId: string;
  existingLinks: Array<{ linkKind: Kind; linkId: string }>;
  projects: ProjectOpt[];
  contacts: ContactOpt[];
  entities: EntityOpt[];
};

/**
 * Picker autocomplete pour lier un thread à un projet / contact / entité.
 * Aligné sur le pattern Paradeos : recherche text-first, pas dropdown
 * géant. Filtre côté client sur les options pré-chargées.
 */
export function LinkPicker({ threadId, existingLinks, projects, contacts, entities }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("project");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const existingSet = useMemo(() => {
    const s = new Set<string>();
    for (const l of existingLinks) s.add(`${l.linkKind}:${l.linkId}`);
    return s;
  }, [existingLinks]);

  const options: Array<{ id: string; label: string }> = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = (lbl: string) => !q || lbl.toLowerCase().includes(q);
    if (kind === "project") {
      return projects
        .filter((p) => !existingSet.has(`project:${p.id}`))
        .map((p) => ({ id: p.id, label: p.name }))
        .filter((o) => filter(o.label))
        .slice(0, 20);
    }
    if (kind === "contact") {
      return contacts
        .filter((c) => !existingSet.has(`contact:${c.id}`))
        .filter((c) => filter(c.label))
        .slice(0, 20);
    }
    return entities
      .filter((e) => !existingSet.has(`entity:${e.id}`))
      .map((e) => ({ id: e.id, label: e.name }))
      .filter((o) => filter(o.label))
      .slice(0, 20);
  }, [kind, query, projects, contacts, entities, existingSet]);

  function link(linkId: string) {
    startTransition(async () => {
      const res = await linkThreadToSubject({ threadId, linkKind: kind, linkId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Lien ajouté.");
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground hover:underline"
      >
        <Plus className="size-3.5" />
        Lier à…
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-2">
      <div className="flex items-center gap-1">
        {(["project", "contact", "entity"] as const).map((k) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={kind === k ? "default" : "outline"}
            onClick={() => setKind(k)}
            className="h-7 text-[11px]"
          >
            {k === "project" ? "Projet" : k === "contact" ? "Contact" : "Entité"}
          </Button>
        ))}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="size-4" />
        </button>
      </div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Rechercher un ${kind === "project" ? "projet" : kind === "contact" ? "contact" : "entité"}…`}
        disabled={pending}
        className="h-8 text-xs"
        autoFocus
      />
      {options.length === 0 ? (
        <p className="text-muted-foreground text-[11px] italic">Aucun résultat.</p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => link(o.id)}
                disabled={pending}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
              >
                <Link2 className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{o.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
