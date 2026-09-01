"use client";

import { ContactPreviewDialog } from "@/components/projects/contact-preview-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { quickCreateContact } from "@/lib/actions/contacts";
import { addProjectContact, removeProjectContact } from "@/lib/actions/project-members";
import { cn } from "@/lib/utils";
import { MagnifyingGlass, Plus, PlusCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LinkChip, LinkGlyph, type LinkItem } from "../link-field/link-chip";
import { LinkPeek, type PeekField } from "../link-field/link-peek";

import { formatPersonName } from "@/lib/format";
type Contact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

function contactName(c: Contact): string {
  const n = formatPersonName(c.firstName, c.lastName, "");
  return n || c.email || "(sans nom)";
}

function toLinkItem(c: Contact): LinkItem {
  return {
    id: c.id,
    name: contactName(c),
    kind: "person",
    role: c.email,
  };
}

/**
 * Champ de liaison "Contacts liés" — chips avatar + popover ajout/création
 * + hover-peek + sheet latéral droit au clic. Conforme au handoff
 * ChampLiaison (variant A · jetons compacts).
 */
export function ProjectContactsField({
  projectId,
  projectEntityId,
  contacts,
  options,
  primaryContactId,
}: {
  projectId: string;
  /** Entité du projet — préremplit `entityId` à la création de contact. */
  projectEntityId: string | null;
  contacts: Contact[];
  options: Contact[];
  /** Contact primaire du projet, exclu du picker (déjà géré ailleurs). */
  primaryContactId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const linkedIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !linkedIds.has(o.id) && o.id !== primaryContactId)
      .filter((o) => (q ? contactName(o).toLowerCase().includes(q) : true))
      .slice(0, 30);
  }, [options, linkedIds, primaryContactId, query]);

  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 &&
    !options.some((o) => contactName(o).toLowerCase() === trimmed.toLowerCase());

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

  function createAndAdd(fullName: string) {
    startTransition(async () => {
      const created = await quickCreateContact({
        fullName,
        ...(projectEntityId ? { entityId: projectEntityId } : {}),
      });
      if (!created.ok) {
        toast.error(created.message);
        return;
      }
      const linked = await addProjectContact({
        projectId,
        contactId: created.data.id,
      });
      if (!linked.ok) {
        toast.error(linked.message);
        return;
      }
      toast.success(`« ${created.data.fullName} » créé et lié.`);
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {contacts.map((c) => {
          const item = toLinkItem(c);
          const fields: PeekField[] = [];
          if (c.email) fields.push({ key: "email", value: c.email });

          return (
            <LinkPeek key={c.id} item={item} fields={fields} href={`/contacts/${c.id}`}>
              <LinkChip
                item={item}
                onClick={() => setPreviewId(c.id)}
                onRemove={() => remove(c.id)}
                disabled={pending}
              />
            </LinkPeek>
          );
        })}

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
              Ajouter
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
                Aucun contact disponible.
              </p>
            ) : (
              <ul className="max-h-60 overflow-y-auto p-1.5">
                {filtered.length > 0 ? (
                  <li className="px-2 pt-1 pb-1.5 font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.08em]">
                    Suggestions
                  </li>
                ) : null}
                {filtered.map((o) => {
                  const item = toLinkItem(o);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => add(o.id)}
                        disabled={pending}
                        className="flex w-full items-center gap-[9px] rounded-md px-2 py-[7px] text-left hover:bg-ds-hover disabled:opacity-50"
                      >
                        <LinkGlyph item={item} size={26} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-[14px] text-ds-text">
                            {contactName(o)}
                          </span>
                          {o.email ? (
                            <span className="block truncate text-[12px] text-ds-text-tertiary">
                              {o.email}
                            </span>
                          ) : null}
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
                onClick={() => createAndAdd(trimmed)}
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

      <ContactPreviewDialog contactId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
