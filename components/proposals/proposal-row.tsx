"use client";

import { Button } from "@/components/ui/button";
import {
  ArrowUUpLeft,
  ArrowUpRight,
  Check,
  LinkSimple,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  editorDraftFor,
  isEditableKind,
  matchedSubtitle,
  matchedViewHref,
  summaryFor,
} from "./helpers";
import { ProposalEditor } from "./proposal-editor";
import { CrossKindBanner, ProposalMetaTags } from "./proposal-meta";
import type { LinkOptions, Proposal, ProposalSourceAdapter } from "./types";
import { HoverRevealButton, IconButton, KindIcon, MatchBadge, NewBadge, RestoreButton } from "./ui";

type RowProps = {
  proposal: Proposal;
  options: LinkOptions;
  adapter: ProposalSourceAdapter;
  onChange: (next: Proposal) => void;
};

/** Ligne de la section « À valider » : pending, validée ou invalidée. */
export function ProposalRow({ proposal, options, adapter, onChange }: RowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const payload = proposal.payload as Record<string, unknown>;

  const matched = proposal.matchedId !== null;
  const confidence = proposal.matchConfidence ? Number(proposal.matchConfidence) : null;
  const isAccepted = proposal.status === "accepted";
  const isRejected = proposal.status === "rejected";
  const editableKind = isEditableKind(proposal.kind) ? proposal.kind : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    editorDraftFor(proposal, options),
  );

  function startEditing() {
    // Repart toujours du payload courant (qui a pu changer via `update`)
    // plutôt que du draft initial figé.
    setDraft(editorDraftFor(proposal, options));
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(editorDraftFor(proposal, options));
    setEditing(false);
  }

  function decide(action: "accept" | "reject", payloadOverride?: Record<string, unknown>) {
    startTransition(async () => {
      const res =
        action === "accept"
          ? await adapter.actions.accept(proposal.id, payloadOverride)
          : await adapter.actions.reject(proposal.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        status: action === "accept" ? "accepted" : "rejected",
        decidedAt: new Date(),
        payload: payloadOverride ? { ...payload, ...payloadOverride } : proposal.payload,
      });
      setEditing(false);
      toast.success(action === "accept" ? adapter.labels.acceptToast(proposal.kind) : "Rejeté.");
      router.refresh();
    });
  }

  function saveAcceptedEdit(next: Record<string, unknown>) {
    startTransition(async () => {
      const res = await adapter.actions.update(proposal.id, next);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({ ...proposal, payload: { ...payload, ...next } });
      setEditing(false);
      toast.success("Mise à jour enregistrée.");
      router.refresh();
    });
  }

  function restore() {
    startTransition(async () => {
      const res = await adapter.actions.revert(proposal.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({ ...proposal, status: "pending", decidedAt: null, decidedBy: null });
      toast.success("Remis en attente.");
      router.refresh();
    });
  }

  if (editing && editableKind) {
    return (
      <li className="px-4 py-3.5">
        <div className="space-y-3">
          <ProposalEditor
            kind={editableKind}
            draft={draft}
            onChange={setDraft}
            options={options}
            initialMatchedId={proposal.matchedId}
            taskAssigneeField={adapter.taskAssigneeField}
          />
          {!isAccepted && matched ? (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              Cette proposition allait être liée à un record existant. Si tu modifies les champs, le
              lien sera ignoré et un nouveau record sera créé (sauf si tu choisis explicitement un
              autre record à lier).
            </p>
          ) : null}
          {isAccepted ? (
            <p className="text-muted-foreground text-xs">
              Modifie les champs : le record déjà créé sera mis à jour en place (pas de doublon).
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={cancelEditing}>
              Annuler
            </Button>
            {isAccepted ? (
              <Button size="sm" disabled={pending} onClick={() => saveAcceptedEdit(draft)}>
                <Check size={14} weight="bold" />
                Enregistrer
              </Button>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => decide("accept", draft)}>
                <Check size={14} weight="bold" />
                Accepter
              </Button>
            )}
          </div>
        </div>
      </li>
    );
  }

  // Bandeau validé : fond vert + pastille + modifier / annuler la validation.
  if (isAccepted) {
    return (
      <li
        className="flex items-center gap-3.5 px-4 py-3.5"
        style={{
          background: "var(--ds-tint-green-bg)",
          borderLeft: "4px solid var(--ds-tint-green-dot)",
        }}
      >
        <span
          title={adapter.labels.acceptedTitle}
          className="inline-flex size-8 flex-none items-center justify-center rounded-full text-white"
          style={{ background: "var(--ds-tint-green-dot)" }}
        >
          <Check size={17} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-foreground text-sm leading-snug">
            {summaryFor(proposal, payload)}
          </span>
          <ProposalMetaTags proposal={proposal} payload={payload} />
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {editableKind ? (
            <IconButton title="Modifier le record lié" onClick={startEditing} disabled={pending}>
              <PencilSimple size={16} weight="duotone" />
            </IconButton>
          ) : null}
          <RestoreButton
            tint="green"
            title="Annuler la validation"
            onClick={restore}
            disabled={pending}
          />
        </div>
      </li>
    );
  }

  // Bandeau invalidé : fond rouge + pastille + titre barré + rétablir.
  if (isRejected) {
    return (
      <li
        className="flex items-center gap-3.5 px-4 py-3.5"
        style={{
          background: "var(--ds-tint-red-bg)",
          borderLeft: "4px solid var(--ds-tint-red-dot)",
        }}
      >
        <span
          title={adapter.labels.rejectedTitle}
          className="inline-flex size-8 flex-none items-center justify-center rounded-full text-white"
          style={{ background: "var(--ds-tint-red-dot)" }}
        >
          <X size={17} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-[var(--ds-text-tertiary)] text-sm leading-snug line-through">
            {summaryFor(proposal, payload)}
          </span>
          <ProposalMetaTags proposal={proposal} payload={payload} />
        </div>
        <RestoreButton tint="red" title="Rétablir" onClick={restore} disabled={pending} />
      </li>
    );
  }

  // Pending : layout normal + actions hover-reveal.
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <KindIcon kind={proposal.kind} />
          <span className="font-medium text-foreground text-sm leading-snug">
            {summaryFor(proposal, payload)}
          </span>
          {matched ? <MatchBadge confidence={confidence} /> : <NewBadge kind={proposal.kind} />}
        </div>
        <ProposalMetaTags proposal={proposal} payload={payload} />
        <CrossKindBanner proposal={proposal} payload={payload} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {editableKind ? (
          <IconButton title="Modifier" onClick={startEditing} disabled={pending}>
            <PencilSimple size={16} weight="duotone" />
          </IconButton>
        ) : null}
        <HoverRevealButton
          tint="red"
          label="Invalider"
          icon={<X size={13} weight="bold" />}
          onClick={() => decide("reject")}
          disabled={pending}
        />
        <HoverRevealButton
          tint="green"
          label="Valider"
          icon={<Check size={13} weight="bold" />}
          ring
          onClick={() => decide("accept")}
          disabled={pending}
        />
      </div>
    </li>
  );
}

/**
 * Ligne « Déjà en base » — proposition pending dont le matchedId pointe sur
 * un record existant. Ton bas, rien n'est attendu de l'utilisateur ; l'action
 * disponible (appliquer le rattachement, détacher un mauvais match, ou rien)
 * dépend de la source.
 */
export function AlreadyInDbRow({ proposal, adapter, onChange }: Omit<RowProps, "options">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const payload = proposal.payload as Record<string, unknown>;
  const title = summaryFor(proposal, payload);
  const subtitle = matchedSubtitle(proposal, payload);
  const viewHref = matchedViewHref(proposal);
  const action = adapter.matchedRowAction(proposal);

  function apply() {
    startTransition(async () => {
      const res = await adapter.actions.accept(proposal.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({ ...proposal, status: "accepted", decidedAt: new Date() });
      toast.success(adapter.labels.acceptToast(proposal.kind));
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await adapter.actions.reject(proposal.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({ ...proposal, status: "rejected", decidedAt: new Date() });
      router.refresh();
    });
  }

  function detach() {
    // Revert → redevient pending sans match. L'utilisateur peut alors
    // ré-éditer / choisir un autre record dans « À valider ».
    startTransition(async () => {
      const res = await adapter.actions.revert(proposal.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        status: "pending",
        matchedId: null,
        matchConfidence: null,
        decidedAt: null,
        decidedBy: null,
      });
      toast.success("Match retiré. Remis dans 'À valider'.");
      router.refresh();
    });
  }

  return (
    <li className="group/qrow flex items-center gap-3 px-4 py-2.5">
      <KindIcon kind={proposal.kind} />
      <span className="truncate font-medium text-foreground text-sm">{title}</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-bg-hover)] px-2 py-0.5 font-semibold text-[11px] text-muted-foreground">
        <LinkSimple size={11} weight="bold" />
        Fiche existante
      </span>
      {subtitle ? (
        <span className="truncate text-[12px] text-[var(--ds-text-tertiary)]">· {subtitle}</span>
      ) : null}
      <span className="flex-1" />
      {action === "detach" ? (
        <button
          type="button"
          onClick={detach}
          disabled={pending}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground disabled:opacity-30 group-hover/qrow:opacity-100"
          title="Mauvaise fiche ? Détache le match — la proposition retourne dans 'À valider'."
        >
          <ArrowUUpLeft size={13} weight="duotone" />
          Mauvaise fiche
        </button>
      ) : null}
      {viewHref ? (
        <Link
          href={viewHref}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight size={12} weight="bold" />
          Voir
        </Link>
      ) : null}
      {action === "apply" ? (
        <>
          <button
            type="button"
            onClick={reject}
            disabled={pending}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground opacity-0 transition-opacity hover:text-destructive disabled:opacity-30 group-hover/qrow:opacity-100"
          >
            <X size={11} weight="bold" />
            Ignorer
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[12px] transition-colors disabled:opacity-50"
            style={{
              background: "var(--ds-tint-green-bg)",
              color: "var(--ds-tint-green-text)",
              boxShadow: "inset 0 0 0 1px var(--ds-tint-green-dot)",
            }}
          >
            <Check size={11} weight="bold" />
            Appliquer
          </button>
        </>
      ) : null}
    </li>
  );
}
