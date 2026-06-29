"use client";

import { EntityPreviewDialog } from "@/components/projects/entity-preview-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { quickCreateEntity } from "@/lib/actions/entities";
import { patchProject } from "@/lib/actions/projects";
import { demoCompanyName } from "@/lib/demo/anonymize";
import { useDemoMode } from "@/lib/demo/context";
import { cn } from "@/lib/utils";
import { MagnifyingGlass, Plus, PlusCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LinkChip, LinkGlyph, type LinkItem } from "../link-field/link-chip";
import { LinkPeek, type PeekField } from "../link-field/link-peek";

type Entity = { id: string; name: string };

/**
 * Champ de liaison "Entité" — 1 entité max sur un projet. Chip Buildings
 * tinté + hover-peek + sheet latéral droit au clic. Si vide, affiche
 * "+ Lier une entité" qui ouvre un picker avec recherche/création.
 *
 * Remplace `ProjEntity` (InlineFk) + `EntityPreviewIconButton` dans
 * la page projet — la sélection/création reste branchée sur
 * `patchProject` / `quickCreateEntity`.
 */
export function ProjectEntityField({
  projectId,
  entity,
  options,
}: {
  projectId: string;
  entity: Entity | null;
  options: Entity[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const demo = useDemoMode();

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => o.id !== entity?.id)
      .filter((o) => (q ? o.name.toLowerCase().includes(q) : true))
      .slice(0, 30);
  }, [options, entity?.id, query]);

  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 && !options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());

  function setEntity(nextId: string | null) {
    startTransition(async () => {
      const res = await patchProject({ id: projectId, entityId: nextId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  function createAndSet(name: string) {
    startTransition(async () => {
      const created = await quickCreateEntity({ name });
      if (!created.ok) {
        toast.error(created.message);
        return;
      }
      const patched = await patchProject({ id: projectId, entityId: created.data.id });
      if (!patched.ok) {
        toast.error(patched.message);
        return;
      }
      toast.success(`« ${created.data.name} » créée et liée.`);
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  if (entity) {
    const displayName = demo ? demoCompanyName(entity.id) : entity.name;
    const item: LinkItem = {
      id: entity.id,
      name: displayName,
      kind: "entity",
    };
    const fields: PeekField[] = [];

    return (
      <div className="flex flex-wrap items-center gap-2">
        <LinkPeek item={item} fields={fields} href={`/entites/${entity.id}`}>
          <LinkChip
            item={item}
            onClick={() => setPreviewOpen(true)}
            onRemove={() => setEntity(null)}
            disabled={pending}
          />
        </LinkPeek>

        <EntityPreviewDialog
          entityId={previewOpen ? entity.id : null}
          onClose={() => setPreviewOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
            className="inline-flex items-center gap-[6px] rounded-md border border-ds-border-strong border-dashed px-[11px] py-[5px] text-[14px] text-ds-text-tertiary leading-[1.35] transition-colors hover:bg-ds-hover hover:text-ds-text-muted"
          >
            <Plus weight="bold" size={11} />
            Lier une entité
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className={cn(
            "w-[300px] overflow-hidden rounded-[10px] p-0",
            "shadow-[rgba(15,15,15,0.05)_0_0_0_1px,rgba(15,15,15,0.08)_0_3px_6px,rgba(15,15,15,0.12)_0_9px_24px]",
          )}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <MagnifyingGlass weight="regular" size={15} className="text-ds-text-tertiary" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              disabled={pending}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className="flex-1 bg-transparent text-[14px] text-ds-text outline-none placeholder:text-ds-text-tertiary"
            />
            <kbd className="inline-flex h-[18px] items-center justify-center rounded border px-1.5 font-mono text-[10px] text-ds-text-tertiary">
              Esc
            </kbd>
          </div>

          {filtered.length === 0 && !showCreate ? (
            <p className="px-3 py-3 text-[13px] text-ds-text-tertiary italic">
              Aucune entité disponible.
            </p>
          ) : (
            <ul className="max-h-60 overflow-y-auto p-1.5">
              {filtered.length > 0 ? (
                <li className="px-2 pt-1 pb-1.5 font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.08em]">
                  Suggestions
                </li>
              ) : null}
              {filtered.map((o) => {
                const item: LinkItem = { id: o.id, name: o.name, kind: "entity" };
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setEntity(o.id)}
                      disabled={pending}
                      className="flex w-full items-center gap-[9px] rounded-md px-2 py-[7px] text-left hover:bg-ds-hover disabled:opacity-50"
                    >
                      <LinkGlyph item={item} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[14px] text-ds-text">
                          {o.name}
                        </span>
                      </span>
                      <Plus weight="bold" size={12} className="text-ds-text-tertiary" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {showCreate ? (
            <button
              type="button"
              onClick={() => createAndSet(trimmed)}
              disabled={pending}
              className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-[14px] hover:bg-ds-hover disabled:opacity-50"
            >
              <PlusCircle weight="regular" size={18} className="text-primary-500" />
              <span className="text-primary-700">
                Créer « <strong className="font-semibold">{trimmed}</strong> »
              </span>
            </button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
