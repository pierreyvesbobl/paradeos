"use client";

import { ContactPreviewDialog } from "@/components/projects/contact-preview-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user/user-avatar";
import { quickCreateContact } from "@/lib/actions/contacts";
import {
  addMeetingParticipant,
  removeMeetingParticipant,
} from "@/lib/actions/meeting-participants";
import type { MeetingParticipantRow } from "@/lib/db/queries/meeting-participants";
import { cn } from "@/lib/utils";
import { MagnifyingGlass, Plus, PlusCircle, Sparkle, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LinkChip, LinkGlyph, type LinkItem } from "../link-field/link-chip";
import { LinkPeek, type PeekField } from "../link-field/link-peek";

export type ParticipantUserOption = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
};
export type ParticipantContactOption = {
  id: string;
  fullName: string;
  entityName: string | null;
};

function toLinkItem(p: MeetingParticipantRow): LinkItem {
  return { id: p.refId ?? p.id, name: p.name, kind: "person", role: p.role };
}

/**
 * « Participants » d'une réunion : membres de l'équipe, contacts CRM, et
 * noms bruts repérés dans le transcript mais sans fiche (jeton pointillé,
 * cliquable pour être remplacé par un vrai record).
 *
 * Un seul champ de recherche pour les deux sources — on cherche une
 * personne, on ne choisit pas d'abord dans quelle table elle vit.
 */
export function MeetingParticipantsField({
  meetingId,
  participants,
  users,
  contacts,
  defaultEntityId,
}: {
  meetingId: string;
  participants: MeetingParticipantRow[];
  users: ParticipantUserOption[];
  contacts: ParticipantContactOption[];
  /** Entité du projet du meeting — préremplit la création de contact. */
  defaultEntityId: string | null;
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

  function add(target: { userId?: string; contactId?: string }) {
    startTransition(async () => {
      const res = await addMeetingParticipant({ meetingId, ...target });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      close();
      router.refresh();
    });
  }

  function remove(participantId: string) {
    startTransition(async () => {
      const res = await removeMeetingParticipant({ meetingId, participantId });
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
        ...(defaultEntityId ? { entityId: defaultEntityId } : {}),
      });
      if (!created.ok) {
        toast.error(created.message);
        return;
      }
      const linked = await addMeetingParticipant({ meetingId, contactId: created.data.id });
      if (!linked.ok) {
        toast.error(linked.message);
        return;
      }
      toast.success(`« ${created.data.fullName} » créé et ajouté aux participants.`);
      close();
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {participants.map((p) => {
          const item = toLinkItem(p);

          if (p.kind === "contact" && p.refId) {
            const fields: PeekField[] = [];
            if (p.role) fields.push({ key: "meta", value: p.role });
            if (p.entityName) fields.push({ key: "entity", value: p.entityName });
            if (p.email) fields.push({ key: "email", value: p.email });
            return (
              <LinkPeek key={p.id} item={item} fields={fields} href={`/contacts/${p.refId}`}>
                <LinkChip
                  item={item}
                  onClick={() => setPreviewId(p.refId)}
                  onRemove={() => remove(p.id)}
                  disabled={pending}
                />
              </LinkPeek>
            );
          }

          if (p.kind === "user") {
            // Pas de fiche « membre » à ouvrir : jeton non cliquable, avec
            // l'avatar réel plutôt que des initiales — l'équipe se
            // distingue des externes au premier coup d'œil.
            return (
              <TeamChip
                key={p.id}
                name={p.name}
                avatarUrl={p.avatarUrl}
                disabled={pending}
                onRemove={() => remove(p.id)}
              />
            );
          }

          // Nom brut : pas de fiche derrière. Le clic rouvre la recherche
          // pré-remplie pour le rattacher à un contact (ou le créer).
          return (
            <LinkChip
              key={p.id}
              item={item}
              onClick={() => {
                setQuery(p.name);
                setOpen(true);
              }}
              onRemove={() => remove(p.id)}
              disabled={pending}
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
                placeholder="Rechercher une personne…"
                disabled={pending}
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
                      disabled={pending}
                      onClick={() => add({ userId: u.id })}
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
                      disabled={pending}
                      onClick={() => add({ contactId: c.id })}
                    />
                  </li>
                ))}
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
            Les jetons en pointillés viennent du transcript et n'ont pas de fiche. Clique dessus
            pour les rattacher.
          </span>
        </p>
      ) : null}

      <ContactPreviewDialog contactId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 pt-1 pb-1.5 font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.08em]">
      {children}
    </li>
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

function OptionButton({
  glyph,
  name,
  subtitle,
  disabled,
  onClick,
}: {
  glyph: React.ReactNode;
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
