"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addTagToThread, createCategoryTagAction } from "@/lib/actions/gmail";
import { Plus, Tag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type TagOpt = {
  id: string;
  kind: "project" | "contact" | "entity" | "category";
  labelName: string;
};

type Props = {
  threadId: string;
  /** Tous les tags disponibles pour ce user (déjà créés). */
  allTags: TagOpt[];
  /** Ids des tags déjà appliqués à ce thread (pour les filtrer). */
  appliedTagIds: string[];
};

const KIND_LABEL: Record<TagOpt["kind"], string> = {
  project: "Projets",
  contact: "Contacts",
  entity: "Entités",
  category: "Catégories",
};

/**
 * Picker autocomplete pour appliquer un tag à un thread. Affiche les
 * tags filtrés par recherche, groupés par kind. Permet aussi de créer
 * une nouvelle catégorie à la volée.
 */
export function TagPicker({ threadId, allTags, appliedTagIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const available = useMemo(() => {
    const applied = new Set(appliedTagIds);
    const q = query.trim().toLowerCase();
    return allTags
      .filter((t) => !applied.has(t.id))
      .filter((t) => !q || t.labelName.toLowerCase().includes(q))
      .slice(0, 50);
  }, [allTags, appliedTagIds, query]);

  const grouped: Record<TagOpt["kind"], TagOpt[]> = useMemo(() => {
    const acc: Record<TagOpt["kind"], TagOpt[]> = {
      project: [],
      contact: [],
      entity: [],
      category: [],
    };
    for (const t of available) acc[t.kind].push(t);
    return acc;
  }, [available]);

  function apply(tagId: string) {
    startTransition(async () => {
      const res = await addTagToThread({ threadId, tagId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Tag appliqué.");
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  function createAndApply() {
    const name = query.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createCategoryTagAction({ name });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const tagId = res.data.id;
      const applied = await addTagToThread({ threadId, tagId });
      if (!applied.ok) {
        toast.error(applied.message);
        return;
      }
      toast.success(`Catégorie « ${name} » créée et appliquée.`);
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
        Ajouter un tag
      </button>
    );
  }

  // Affiche le bouton "Créer la catégorie X" si query non-vide et pas de match exact.
  const exactMatch = available.find((t) => t.labelName.toLowerCase().endsWith(query.toLowerCase()));
  const showCreate = query.trim().length > 0 && !exactMatch;

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-2">
      <div className="flex items-center gap-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher ou créer une catégorie…"
          disabled={pending}
          className="h-8 text-xs"
          // biome-ignore lint/a11y/noAutofocus: dialog-like picker
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="size-4" />
        </button>
      </div>

      {showCreate ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={createAndApply}
          disabled={pending}
          className="h-7 w-full justify-start gap-1.5 text-[11px]"
        >
          <Plus className="size-3" />
          Créer la catégorie « {query.trim()} »
        </Button>
      ) : null}

      <div className="max-h-72 space-y-2 overflow-y-auto">
        {(["category", "project", "contact", "entity"] as const).map((kind) => {
          const items = grouped[kind];
          if (items.length === 0) return null;
          return (
            <div key={kind}>
              <p className="px-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                {KIND_LABEL[kind]}
              </p>
              <ul className="space-y-0.5">
                {items.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => apply(t.id)}
                      disabled={pending}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
                    >
                      <Tag className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {/* Affiche le dernier segment du label_name (sans préfixe Paradeos/Kind/). */}
                        {t.labelName.split("/").pop()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {available.length === 0 && !showCreate ? (
          <p className="px-1 text-[11px] text-muted-foreground italic">Aucun tag disponible.</p>
        ) : null}
      </div>
    </div>
  );
}
