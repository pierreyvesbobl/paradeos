"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user/user-avatar";
import { addProjectMember, removeProjectMember } from "@/lib/actions/project-members";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Member = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
};

/**
 * Chips multi-select pour les membres d'un projet (en plus du lead).
 * UI : chips avec bouton X par membre + bouton « + Ajouter » qui ouvre
 * une recherche filtrée sur les users non-déjà-membres.
 */
export function ProjectMembersField({
  projectId,
  members,
  options,
  ownerId,
}: {
  projectId: string;
  members: Member[];
  options: Member[];
  /** Le lead du projet, exclu de l'add picker (déjà éditable via ProjOwner). */
  ownerId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !memberIds.has(o.id) && o.id !== ownerId)
      .filter((o) => (q ? (o.fullName ?? "").toLowerCase().includes(q) : true))
      .slice(0, 30);
  }, [options, memberIds, ownerId, query]);

  function add(userId: string) {
    startTransition(async () => {
      const res = await addProjectMember({ projectId, userId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(userId: string) {
    startTransition(async () => {
      const res = await removeProjectMember({ projectId, userId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {members.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <li
              key={m.id}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pr-1 pl-1.5 text-xs"
            >
              <UserAvatar size="sm" name={m.fullName} avatarUrl={m.avatarUrl} />
              <span className="max-w-[140px] truncate">{m.fullName ?? "(sans nom)"}</span>
              <button
                type="button"
                onClick={() => remove(m.id)}
                disabled={pending}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                aria-label={`Retirer ${m.fullName ?? "ce membre"}`}
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
        <PopoverContent align="start" className="w-64 space-y-1 p-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un membre…"
            disabled={pending}
            className="w-full rounded-sm bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:bg-muted/50"
          />
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-1.5 py-1 text-[11px] text-muted-foreground italic">
                Aucun membre disponible
              </li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => add(o.id)}
                    disabled={pending}
                    className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <UserAvatar size="sm" name={o.fullName} avatarUrl={o.avatarUrl} />
                    <span className="truncate">{o.fullName ?? "(sans nom)"}</span>
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
