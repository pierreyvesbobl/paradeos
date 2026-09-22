"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user/user-avatar";
import { quickCreateContact } from "@/lib/actions/contacts";
import { cn } from "@/lib/utils";
import { MagnifyingGlass, Plus, PlusCircle, Sparkle, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LinkChip, LinkGlyph, type LinkItem } from "../link-field/link-chip";
import { LinkPeek, type PeekField } from "../link-field/link-peek";

export type ParticipantUserOption = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
};
export type ParticipantContactOption = { id: string; fullName: string; entityName: string | null };

/** Une personne affichée en jeton, qu'elle soit déjà en base ou encore locale. */
export type ParticipantDraft = {
  /** Id de ligne côté base, ou clé locale côté formulaire de création. */
  key: string;
  kind: "user" | "contact" | "name";
  refId: string | null;
  name: string;
  /** Rôle, entité, « Paradeos »… affiché sous le nom dans la recherche. */
  subtitle: string | null;
  avatarUrl: string | null;
  /** Aperçu au survol — seulement pour les personnes déjà en base. */
  peek?: { href: string; fields: PeekField[] };
};

export type ParticipantTarget =
  | { userId: string }
  | { contactId: string }
  | { displayName: string };

/**
 * Libellé connu au moment du choix — sert aux appelants qui gèrent une
 * liste locale : un contact tout juste créé n'est pas encore dans les
 * options rendues côté serveur.
 */
export type ParticipantLabel = { name: string; subtitle: string | null };

/**
 * Sélecteur de personnes d'une réunion : jetons + recherche unique sur
 * l'équipe et les contacts. Ne décide pas du stockage — l'appelant câble
 * `onAdd` / `onRemove`, qui écrivent en base (fiche réunion) ou dans un
 * état local (formulaire de création).
 */
export function ParticipantsPicker({
  participants,
  users,
  contacts,
  defaultEntityId,
  disabled = false,
  onAdd,
  onRemove,
  onOpenContact,
}: {
  participants: ParticipantDraft[];
  users: ParticipantUserOption[];
  contacts: ParticipantContactOption[];
  /** Entité préremplie à la création d'un contact depuis la recherche. */
  defaultEntityId: string | null;
  disabled?: boolean;
  onAdd: (target: ParticipantTarget, label?: ParticipantLabel) => void;
  onRemove: (key: string) => void;
  /** Fourni quand un clic sur un jeton contact doit ouvrir sa fiche. */
  onOpenContact?: (contactId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const linkedUserIds = useMemo(
    () => new Set(participants.filter((p) => p.kind === "user").map((p) => p.refId)),
    [participants],
  );
  const linkedContactIds = useMemo(
    () => new Set(participants.filter((p) => p.kind === "contact").map((p) => p.refId)),
    [participants],
  );

  const q = query.trim().toLowerCase();
  const userMatches = useMemo(
    () =>
      users
        .filter((u) => !linkedUserIds.has(u.id))
        .filter((u) => (q ? (u.fullName ?? "").toLowerCase().includes(q) : true))
        .slice(0, 10),
    [users, linkedUserIds, q],
  );
  const contactMatches = useMemo(
    () =>
      contacts
        .filter((c) => !linkedContactIds.has(c.id))
        .filter((c) =>
          q
            ? c.fullName.toLowerCase().includes(q) || (c.entityName ?? "").toLowerCase().includes(q)
            : true,
        )
        .slice(0, 20),
    [contacts, linkedContactIds, q],
  );

  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 1 &&
    !contacts.some((c) => c.fullName.toLowerCase() === trimmed.toLowerCase()) &&
    !users.some((u) => (u.fullName ?? "").toLowerCase() === trimmed.toLowerCase());

  function close() {
    setQuery("");
    setOpen(false);
  }

  function pick(target: ParticipantTarget, label?: ParticipantLabel) {
    onAdd(target, label);
    close();
  }

  async function createAndAdd(fullName: string) {
    const created = await quickCreateContact({
      fullName,
      ...(defaultEntityId ? { entityId: defaultEntityId } : {}),
    });
    if (!created.ok) {
      toast.error(created.message);
      return;
    }
    toast.success(`« ${created.data.fullName} » créé.`);
    pick({ contactId: created.data.id }, { name: created.data.fullName, subtitle: null });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {participants.map((p) => {
          const item: LinkItem = {
            id: p.refId ?? p.key,
            name: p.name,
            kind: "person",
            role: p.subtitle,
          };

          if (p.kind === "user") {
            // Pas de fiche « membre » à ouvrir : jeton non cliquable, avec
            // l'avatar réel plutôt que des initiales — l'équipe se
            // distingue des externes au premier coup d'œil.
            return (
              <TeamChip
                key={p.key}
                name={p.name}
                avatarUrl={p.avatarUrl}
                disabled={disabled}
                onRemove={() => onRemove(p.key)}
              />
            );
          }

          if (p.kind === "contact") {
            const chip = (
              <LinkChip
                item={item}
                onClick={
                  onOpenContact && p.refId ? () => onOpenContact(p.refId as string) : undefined
                }
                onRemove={() => onRemove(p.key)}
                disabled={disabled}
              />
            );
            return p.peek ? (
              <LinkPeek key={p.key} item={item} fields={p.peek.fields} href={p.peek.href}>
                {chip}
              </LinkPeek>
            ) : (
              <span key={p.key}>{chip}</span>
            );
          }

          // Nom brut : pas de fiche derrière. Le clic rouvre la recherche
          // pré-remplie pour le rattacher à un contact (ou le créer).
          return (
            <LinkChip
              key={p.key}
              item={item}
              onClick={() => {
                setQuery(p.name);
                setOpen(true);
              }}
              onRemove={() => onRemove(p.key)}
              disabled={disabled}
              className="border border-ds-border-strong border-dashed bg-transparent shadow-none"
            />
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
              disabled={disabled}
              className="inline-flex items-center gap-[6px] rounded-md border border-ds-border-strong border-dashed px-[11px] py-[5px] text-[14px] text-ds-text-tertiary leading-[1.35] transition-colors hover:bg-ds-hover hover:text-ds-text-muted disabled:opacity-50"
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
                placeholder="Rechercher une personne…"
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  }
                }}
                className="flex-1 bg-transparent text-[14px] text-ds-text outline-none placeholder:text-ds-text-tertiary"
              />
              <kbd className="inline-flex h-[18px] items-center justify-center rounded border px-1.5 font-mono text-[10px] text-ds-text-tertiary">
                Esc
              </kbd>
            </div>

            {userMatches.length === 0 && contactMatches.length === 0 && !showCreate ? (
              <p className="px-3 py-3 text-[13px] text-ds-text-tertiary italic">
                Personne à ajouter.
              </p>
            ) : (
              <ul className="max-h-60 overflow-y-auto p-1.5">
                {userMatches.length > 0 ? <GroupLabel>Équipe</GroupLabel> : null}
                {userMatches.map((u) => (
                  <li key={u.id}>
                    <OptionButton
                      glyph={<UserAvatar size="md" name={u.fullName} avatarUrl={u.avatarUrl} />}
                      name={u.fullName ?? "(sans nom)"}
                      subtitle="Paradeos"
                      disabled={disabled}
                      onClick={() =>
                        pick(
                          { userId: u.id },
                          {
                            name: u.fullName ?? "(sans nom)",
                            subtitle: "Paradeos",
                          },
                        )
                      }
                    />
                  </li>
                ))}

                {contactMatches.length > 0 ? <GroupLabel>Contacts</GroupLabel> : null}
                {contactMatches.map((c) => (
                  <li key={c.id}>
                    <OptionButton
                      glyph={
                        <LinkGlyph
                          item={{ id: c.id, name: c.fullName, kind: "person" }}
                          size={26}
                        />
                      }
                      name={c.fullName}
                      subtitle={c.entityName}
                      disabled={disabled}
                      onClick={() =>
                        pick({ contactId: c.id }, { name: c.fullName, subtitle: c.entityName })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}

            {showCreate ? (
              <button
                type="button"
                onClick={() => createAndAdd(trimmed)}
                disabled={disabled}
                className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-[14px] hover:bg-ds-hover disabled:opacity-50"
              >
                <PlusCircle weight="regular" size={18} className="text-primary-500" />
                <span className="text-primary-700">
                  Créer le contact « <strong className="font-semibold">{trimmed}</strong> »
                </span>
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      {participants.some((p) => p.kind === "name") ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ds-text-tertiary">
          <Sparkle weight="duotone" size={13} className="mt-[2px] shrink-0" />
          <span>
            Les jetons en pointillés n'ont pas de fiche. Clique dessus pour les rattacher à un
            contact.
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Jeton d'un membre de l'équipe : avatar réel, pas de fiche à ouvrir. */
function TeamChip({
  name,
  avatarUrl,
  disabled,
  onRemove,
}: {
  name: string;
  avatarUrl: string | null;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="group inline-flex max-w-[230px] items-center gap-[7px] rounded-md bg-ds-surface py-[4px] pr-[5px] pl-[5px] text-[14px] text-ds-text leading-[1.35] shadow-[0_0_0_1px_var(--ds-border)]">
      <UserAvatar size="xs" name={name} avatarUrl={avatarUrl} />
      <span className="truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Retirer ${name}`}
        className="inline-flex size-[17px] shrink-0 items-center justify-center rounded text-ds-text-tertiary opacity-0 transition-opacity duration-150 hover:bg-background hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 group-hover:opacity-100"
      >
        <X weight="bold" size={10} />
      </button>
    </span>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <li className="px-2 pt-1 pb-1.5 font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.08em]">
      {children}
    </li>
  );
}

function OptionButton({
  glyph,
  name,
  subtitle,
  disabled,
  onClick,
}: {
  glyph: ReactNode;
  name: string;
  subtitle: string | null;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-[9px] rounded-md px-2 py-[7px] text-left hover:bg-ds-hover disabled:opacity-50"
    >
      {glyph}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[14px] text-ds-text">{name}</span>
        {subtitle ? (
          <span className="block truncate text-[12px] text-ds-text-tertiary">{subtitle}</span>
        ) : null}
      </span>
      <Plus weight="bold" size={12} className="text-ds-text-tertiary" />
    </button>
  );
}
