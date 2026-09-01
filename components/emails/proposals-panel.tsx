"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { type AssigneeRef, AssigneesPicker } from "@/components/tasks/assignees-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EmailProposal } from "@/db/schema/gmail";
import {
  acceptEmailProposal,
  rejectEmailProposal,
  revertEmailProposal,
  updateAcceptedEmailProposal,
} from "@/lib/actions/email-proposals";
import { quickCreateEntity } from "@/lib/actions/entities";
import type { ExtractionMeta } from "@/lib/gmail/queries";
import {
  ArrowCounterClockwise,
  ArrowUpRight,
  Briefcase,
  Buildings,
  Calendar,
  CalendarX,
  Check,
  CheckCircle,
  EnvelopeSimple,
  Folder,
  IdentificationBadge,
  LinkSimple,
  ListChecks,
  PaperPlaneTilt,
  PencilSimple,
  PlusCircle,
  ArrowBendUpLeft as Reply,
  Sparkle,
  Tag,
  User,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { formatPersonName } from "@/lib/format";
type ProjectOption = { id: string; name: string };
type UserOption = { id: string; fullName: string | null; avatarUrl?: string | null };
type NamedOption = { id: string; name: string };
type ContactOption = { id: string; fullName: string; entityName?: string | null };

type LinkOptions = {
  projects: ProjectOption[];
  users: UserOption[];
  entities: NamedOption[];
  contacts: ContactOption[];
};

type EmailKind = EmailProposal["kind"];

/**
 * Ordre d'affichage cohérent avec meetings : actions humaines en premier
 * (task, project, contact, entity), puis liens automatiques (project_link,
 * category_tag). Le draft_reply est traité à part au-dessus des sections.
 */
const KIND_ORDER: EmailKind[] = [
  "task",
  "project",
  "contact",
  "entity",
  "project_link",
  "category_tag",
];

type ProposalWithMatches = EmailProposal & {
  matchedProjectName: string | null;
  matchedContactName: string | null;
  matchedEntityName: string | null;
  matchedTagLabel: string | null;
};

type Props = {
  proposals: ProposalWithMatches[];
  extractionMeta: ExtractionMeta | null;
  extractionStatus: string;
  linkedProjectStatus: string | null;
  linkedProjectName: string | null;
  projects: ProjectOption[];
  usersList: UserOption[];
  entities: NamedOption[];
  contacts: ContactOption[];
};

export function EmailProposalsPanel({
  proposals: serverProposals,
  extractionMeta,
  extractionStatus,
  linkedProjectStatus,
  linkedProjectName,
  projects,
  usersList,
  entities,
  contacts,
}: Props) {
  const linkOptions: LinkOptions = { projects, users: usersList, entities, contacts };
  const [proposals, setProposals] = useState<ProposalWithMatches[]>(serverProposals);

  useEffect(() => {
    setProposals(serverProposals);
  }, [serverProposals]);

  function patchProposal(id: string, mutate: (p: ProposalWithMatches) => ProposalWithMatches) {
    setProposals((prev) => prev.map((p) => (p.id === id ? mutate(p) : p)));
  }

  // Extrait le brouillon de réponse à part — traité comme un cta principal
  // au dessus des propositions CRM.
  const draftReply = proposals.find((p) => p.kind === "draft_reply" && p.status === "pending");
  const crmProposals = proposals.filter((p) => p.kind !== "draft_reply");

  // Design v4 des meetings : "À valider" = vraiment nouveau (pending sans
  // matchedId) + tous les decided ; "Déjà en base" = pending matched.
  const orderRank: Record<EmailProposal["status"], number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
  };
  const grouped = groupByKind(crmProposals);
  const flat = KIND_ORDER.flatMap((k) => grouped[k] ?? []).sort(
    (a, b) => orderRank[a.status] - orderRank[b.status],
  );
  const toReview = flat.filter((p) => p.status !== "pending" || p.matchedId === null);
  const alreadyInDb = flat.filter((p) => p.status === "pending" && p.matchedId !== null);

  const pendingCount = toReview.filter((p) => p.status === "pending").length;
  const acceptedCount = toReview.filter((p) => p.status === "accepted").length;
  const rejectedCount = toReview.filter((p) => p.status === "rejected").length;

  function markAll(status: "accepted" | "rejected") {
    const pendingIds = toReview.filter((p) => p.status === "pending").map((p) => p.id);
    for (const id of pendingIds) {
      patchProposal(id, (p) => ({ ...p, status, decidedAt: new Date() }));
    }
  }

  const hasAnyContent =
    !!extractionMeta || !!draftReply || toReview.length > 0 || alreadyInDb.length > 0;

  if (!hasAnyContent) {
    return (
      <div className="space-y-3">
        <ExtractionStatusCard status={extractionStatus} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {extractionMeta ? (
        <ExtractionMetaCard
          meta={extractionMeta}
          linkedProjectStatus={linkedProjectStatus}
          linkedProjectName={linkedProjectName}
        />
      ) : (
        <ExtractionStatusCard status={extractionStatus} />
      )}

      {draftReply ? (
        <DraftReplySection
          proposal={draftReply}
          onDecide={(next) => patchProposal(draftReply.id, () => next)}
        />
      ) : null}

      {toReview.length > 0 ? (
        <section className="space-y-3">
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-[16px] text-foreground">À valider</h2>
            {pendingCount > 0 ? (
              <CountPill tint="yellow" label={`${pendingCount} en attente`} dot />
            ) : null}
            {acceptedCount > 0 ? (
              <CountPill
                tint="green"
                label={`${acceptedCount} validé${acceptedCount > 1 ? "s" : ""}`}
                icon="check"
              />
            ) : null}
            {rejectedCount > 0 ? (
              <CountPill
                tint="red"
                label={`${rejectedCount} invalidé${rejectedCount > 1 ? "s" : ""}`}
                icon="x"
              />
            ) : null}
            <span className="flex-1" />
            {pendingCount > 0 ? (
              <BulkDecideButtons
                pendingIds={toReview.filter((p) => p.status === "pending").map((p) => p.id)}
                onMarkAll={markAll}
              />
            ) : null}
          </header>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {toReview.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  options={linkOptions}
                  onChange={(next) => patchProposal(p.id, () => next)}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {alreadyInDb.length > 0 ? (
        <section className="space-y-3">
          <header className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold text-[16px] text-muted-foreground">Déjà en base</h2>
            <span className="text-[12px] text-[var(--ds-text-tertiary)]">
              {alreadyInDb.length} élément{alreadyInDb.length > 1 ? "s" : ""} · rattaché
              {alreadyInDb.length > 1 ? "s" : ""} automatiquement
            </span>
          </header>
          <div className="overflow-hidden rounded-xl border bg-[var(--ds-bg-surface)]">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[12px] text-muted-foreground">
              <CheckCircle size={15} weight="duotone" className="text-[var(--ds-tint-green-dot)]" />
              Reconnus dans la base et liés à ce fil. Rien à valider — intervenez si le match est
              faux.
            </div>
            <ul className="divide-y">
              {alreadyInDb.map((p) => (
                <AlreadyInDbRow
                  key={p.id}
                  proposal={p}
                  onChange={(next) => patchProposal(p.id, () => next)}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ─── Extraction meta card (résumé + intent + stage + needsReply) ────────

const INTENT_LABEL: Record<ExtractionMeta["intent"], string> = {
  info: "Info",
  request: "Requête",
  fyi: "FYI",
  decision: "Décision",
  follow_up: "Relance",
  compta: "Compta",
  admin: "Admin",
  other: "Autre",
};

const STAGE_STYLE: Record<
  ExtractionMeta["pipelineStage"],
  { label: string; tint: "blue" | "yellow" | "green" | "gray" }
> = {
  lead: { label: "Lead", tint: "blue" },
  opportunity: { label: "Opportunité", tint: "yellow" },
  project: { label: "Projet", tint: "green" },
  none: { label: "—", tint: "gray" },
};

function ExtractionMetaCard({
  meta,
  linkedProjectStatus,
  linkedProjectName,
}: {
  meta: ExtractionMeta;
  linkedProjectStatus: string | null;
  linkedProjectName: string | null;
}) {
  const stage = STAGE_STYLE[meta.pipelineStage];
  const stageDiffers =
    meta.pipelineStage !== "none" &&
    linkedProjectStatus &&
    !pipelineStageMatchesStatus(meta.pipelineStage, linkedProjectStatus);

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex items-center gap-2">
        <Sparkle size={16} weight="duotone" className="text-[var(--ds-primary-500)]" />
        <h3 className="font-semibold text-[15px]">Extraction IA</h3>
      </header>
      <p className="text-[14px] leading-relaxed">{meta.summary}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tint tint="gray" label={INTENT_LABEL[meta.intent]} />
        {meta.pipelineStage !== "none" ? <Tint tint={stage.tint} label={stage.label} /> : null}
        {meta.needsReply ? <Tint tint="blue" label="Réponse attendue" icon="reply" /> : null}
      </div>
      {stageDiffers && linkedProjectName ? (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Projet <strong>« {linkedProjectName} »</strong> est en <em>{linkedProjectStatus}</em>.
          L'IA suggère de passer en <strong>{stage.label}</strong>.
        </p>
      ) : null}
    </section>
  );
}

function ExtractionStatusCard({ status }: { status: string }) {
  const msg =
    status === "pending"
      ? "Extraction en attente — sera lancée au prochain sync."
      : status === "failed"
        ? "L'extraction a échoué. Relance-la depuis /emails/propositions."
        : status === "skipped"
          ? "Message non extrait (pas de match CRM lors du sync)."
          : "Extraction OK, mais métadonnées non stockées — re-lance l'extraction pour ce message.";
  return (
    <section className="rounded-xl border bg-card p-4">
      <p className="text-muted-foreground text-sm">{msg}</p>
    </section>
  );
}

function pipelineStageMatchesStatus(
  stage: ExtractionMeta["pipelineStage"],
  status: string,
): boolean {
  if (stage === "lead") return status === "not_started";
  if (stage === "opportunity") return status === "to_follow_up" || status === "awaiting_response";
  if (stage === "project")
    return (
      status === "won" ||
      status === "planning" ||
      status === "active" ||
      status === "on_hold" ||
      status === "completed"
    );
  return true;
}

// ─── Draft reply prominently at top ─────────────────────────────────────

function DraftReplySection({
  proposal,
  onDecide,
}: {
  proposal: ProposalWithMatches;
  onDecide: (next: ProposalWithMatches) => void;
}) {
  const router = useRouter();
  const payload = proposal.payload as Record<string, unknown>;
  const [subject, setSubject] = useState(String(payload.subject ?? ""));
  const [body, setBody] = useState(String(payload.body ?? ""));
  const [pending, startTransition] = useTransition();

  function push() {
    startTransition(async () => {
      const res = await acceptEmailProposal({
        proposalId: proposal.id,
        payloadOverride: { subject, body },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Brouillon poussé dans Gmail.");
      onDecide({ ...proposal, status: "accepted", decidedAt: new Date() });
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectEmailProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onDecide({ ...proposal, status: "rejected", decidedAt: new Date() });
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-[var(--ds-tint-blue-bg)] px-4 py-3">
        <Reply size={16} weight="duotone" className="text-[var(--ds-tint-blue-text)]" />
        <h3 className="font-semibold text-[14px] text-[var(--ds-tint-blue-text)]">
          Brouillon de réponse suggéré
        </h3>
      </header>
      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <label
            htmlFor={`draft-subject-${proposal.id}`}
            className="text-[11px] text-muted-foreground"
          >
            Sujet
          </label>
          <Input
            id={`draft-subject-${proposal.id}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={pending}
            className="h-8 text-[13px]"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`draft-body-${proposal.id}`}
            className="text-[11px] text-muted-foreground"
          >
            Corps
          </label>
          <Textarea
            id={`draft-body-${proposal.id}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={7}
            className="resize-y font-mono text-[12px] leading-relaxed"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={reject}
            disabled={pending}
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          >
            <X size={12} weight="bold" />
            Ignorer
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={push}
            disabled={pending || !subject.trim() || !body.trim()}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <PaperPlaneTilt size={12} weight="bold" />
            {pending ? "Envoi…" : "Créer dans Gmail"}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── Row components (À valider) ─────────────────────────────────────────

function ProposalRow({
  proposal,
  options,
  onChange,
}: {
  proposal: ProposalWithMatches;
  options: LinkOptions;
  onChange: (next: ProposalWithMatches) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const payload = proposal.payload as Record<string, unknown>;

  const matched = proposal.matchedId !== null;
  const confidence = proposal.matchConfidence ? Number(proposal.matchConfidence) : null;
  const isAccepted = proposal.status === "accepted";
  const isRejected = proposal.status === "rejected";
  const isEditable =
    proposal.kind === "task" ||
    proposal.kind === "project" ||
    proposal.kind === "contact" ||
    proposal.kind === "entity";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(payload);

  function startEditing() {
    setDraft(payload);
    setEditing(true);
  }

  function decide(action: "accept" | "reject", payloadOverride?: Record<string, unknown>) {
    startTransition(async () => {
      const res =
        action === "accept"
          ? await acceptEmailProposal({
              proposalId: proposal.id,
              payloadOverride: payloadOverride ?? null,
            })
          : await rejectEmailProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        status: action === "accept" ? "accepted" : "rejected",
        decidedAt: new Date(),
        ...(payloadOverride
          ? { payload: { ...(proposal.payload as Record<string, unknown>), ...payloadOverride } }
          : {}),
      });
      setEditing(false);
      toast.success(action === "accept" ? SUCCESS_MSG[proposal.kind] : "Rejeté.");
      router.refresh();
    });
  }

  function saveAcceptedEdit(next: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateAcceptedEmailProposal({ proposalId: proposal.id, payload: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        payload: { ...(proposal.payload as Record<string, unknown>), ...next },
      });
      setEditing(false);
      toast.success("Mise à jour enregistrée.");
      router.refresh();
    });
  }

  function restore() {
    startTransition(async () => {
      const res = await revertEmailProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        status: "pending",
        decidedAt: null,
        decidedBy: null,
      });
      toast.success("Remis en attente.");
      router.refresh();
    });
  }

  if (editing && isEditable) {
    return (
      <li className="px-4 py-3.5">
        <div className="space-y-3">
          <ProposalEditor
            kind={proposal.kind as "task" | "project" | "contact" | "entity"}
            draft={draft}
            onChange={setDraft}
            options={options}
            initialMatchedId={proposal.matchedId}
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
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDraft(payload);
                setEditing(false);
              }}
            >
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
          title="Validé · créé/appliqué"
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
          {isEditable ? (
            <IconButton title="Modifier le record lié" onClick={startEditing} disabled={pending}>
              <PencilSimple size={16} weight="duotone" />
            </IconButton>
          ) : null}
          <button
            type="button"
            onClick={restore}
            disabled={pending}
            title="Annuler la validation"
            aria-label="Annuler la validation"
            className="inline-flex size-8 items-center justify-center rounded-md border bg-[var(--ds-bg-app)] transition-colors hover:bg-[var(--ds-bg-hover)] disabled:opacity-50"
            style={{
              borderColor: "var(--ds-tint-green-dot)",
              color: "var(--ds-tint-green-text)",
            }}
          >
            <ArrowCounterClockwise size={14} weight="bold" />
          </button>
        </div>
      </li>
    );
  }

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
          title="Invalidé"
          className="inline-flex size-8 flex-none items-center justify-center rounded-full text-white"
          style={{ background: "var(--ds-tint-red-dot)" }}
        >
          <X size={17} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-[var(--ds-text-tertiary)] text-sm leading-snug line-through">
            {summaryFor(proposal, payload)}
          </span>
        </div>
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          title="Rétablir"
          aria-label="Rétablir"
          className="inline-flex size-8 flex-none items-center justify-center rounded-md border bg-[var(--ds-bg-app)] transition-colors hover:bg-[var(--ds-bg-hover)] disabled:opacity-50"
          style={{
            borderColor: "var(--ds-tint-red-dot)",
            color: "var(--ds-tint-red-text)",
          }}
        >
          <ArrowCounterClockwise size={14} weight="bold" />
        </button>
      </li>
    );
  }

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
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isEditable ? (
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

// ─── Editor + IconButton ────────────────────────────────────────────────

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

const LINK_LABEL: Record<"task" | "project" | "contact" | "entity", string> = {
  task: "Lier à une tâche existante",
  project: "Lier à un projet existant",
  contact: "Lier à un contact existant",
  entity: "Lier à une entité existante",
};

const LINK_SEARCH_PLACEHOLDER: Record<"task" | "project" | "contact" | "entity", string> = {
  task: "Rechercher une tâche…",
  project: "Rechercher un projet…",
  contact: "Rechercher un contact…",
  entity: "Rechercher une entité…",
};

function ProposalEditor({
  kind,
  draft,
  onChange,
  options,
  initialMatchedId,
}: {
  kind: "task" | "project" | "contact" | "entity";
  draft: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  options: LinkOptions;
  initialMatchedId: string | null;
}) {
  function patch(partial: Record<string, unknown>) {
    onChange({ ...draft, ...partial });
  }
  function val(key: string): string {
    const v = draft[key];
    return v == null ? "" : String(v);
  }

  const linkOptions =
    kind === "project"
      ? options.projects.map((p) => ({ id: p.id, label: p.name }))
      : kind === "contact"
        ? options.contacts.map((c) => ({ id: c.id, label: c.fullName || "(sans nom)" }))
        : kind === "entity"
          ? options.entities.map((e) => ({ id: e.id, label: e.name }))
          : []; // task : pas de "lier à une tâche existante" pour le MVP

  const currentLinkId =
    typeof draft._linkExistingId === "string" && draft._linkExistingId.length > 0
      ? draft._linkExistingId
      : initialMatchedId && (draft._linkExistingId === undefined || draft._linkExistingId === null)
        ? initialMatchedId
        : "";
  const isLinking = currentLinkId !== "";

  const linkPicker =
    linkOptions.length > 0 ? (
      <div className="space-y-1.5 rounded border bg-muted/30 p-3">
        <Label htmlFor="_linkExistingId" className="text-xs">
          {LINK_LABEL[kind]} (optionnel)
        </Label>
        <FkCombobox
          id="_linkExistingId"
          value={currentLinkId || null}
          onValueChange={(v) => patch({ _linkExistingId: v })}
          options={linkOptions}
          placeholder="— Créer un nouveau —"
          searchPlaceholder={LINK_SEARCH_PLACEHOLDER[kind]}
          clearLabel="Créer un nouveau"
        />
        {isLinking ? (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
            La proposition sera liée au record existant. Aucun nouveau record ne sera créé.
          </p>
        ) : null}
      </div>
    ) : null;

  if (isLinking) return <>{linkPicker}</>;

  const fields = renderCreateFields();
  return (
    <div className="space-y-3">
      {linkPicker}
      {fields}
    </div>
  );

  function renderCreateFields() {
    switch (kind) {
      case "task":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Titre" htmlFor="title">
              <Input
                id="title"
                value={val("title")}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field className="sm:col-span-2" label="Assignés" htmlFor="assignees">
              <TaskAssigneesField draft={draft} onPatch={patch} options={options} />
              {(() => {
                const assignees = readAssignees(draft);
                const suggestion = draft.assigneeName as string | null | undefined;
                if (suggestion && assignees.length === 0) {
                  return (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      LLM avait suggéré « {String(suggestion)} » — non trouvé en base.
                    </p>
                  );
                }
                return null;
              })()}
            </Field>
            <Field label="Échéance" htmlFor="dueDate">
              <Input
                id="dueDate"
                type="date"
                value={val("dueDate")}
                onChange={(e) => patch({ dueDate: e.target.value || null })}
              />
            </Field>
            <Field label="Projet" htmlFor="projectId">
              <FkCombobox
                id="projectId"
                value={val("projectId") || null}
                onValueChange={(id) => {
                  const proj = id ? options.projects.find((p) => p.id === id) : null;
                  patch({ projectId: id, projectName: proj?.name ?? null });
                }}
                options={options.projects.map((p) => ({ id: p.id, label: p.name }))}
                placeholder="— Aucun projet —"
                searchPlaceholder="Rechercher un projet…"
                clearLabel="Aucun projet"
              />
              {draft.projectName && !draft.projectId ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  LLM avait suggéré « {String(draft.projectName)} » — non trouvé en base.
                </p>
              ) : null}
            </Field>
            <Field label="Priorité" htmlFor="priority">
              <select
                id="priority"
                value={val("priority") || "normal"}
                onChange={(e) => patch({ priority: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="low">Basse</option>
                <option value="normal">Normale</option>
                <option value="high">Haute</option>
              </select>
            </Field>
          </div>
        );

      case "project":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Nom" htmlFor="name">
              <Input
                id="name"
                value={val("name")}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Type" htmlFor="kind">
              <select
                id="kind"
                value={val("kind") || "client"}
                onChange={(e) => patch({ kind: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="client">Client</option>
                <option value="product">Produit</option>
                <option value="transverse">Transverse</option>
              </select>
            </Field>
            <Field className="sm:col-span-2" label="Entité" htmlFor="entityId">
              <FkCombobox
                id="entityId"
                value={val("entityId") || null}
                onValueChange={(id) => {
                  const ent = id ? options.entities.find((e) => e.id === id) : null;
                  patch({ entityId: id, entityName: ent?.name ?? null });
                }}
                onCreate={async (name) => {
                  const res = await quickCreateEntity({ name });
                  if (!res.ok) return null;
                  patch({ entityId: res.data.id, entityName: res.data.name });
                  return { id: res.data.id, label: res.data.name };
                }}
                options={options.entities.map((e) => ({ id: e.id, label: e.name }))}
                placeholder="— Aucune —"
                searchPlaceholder="Rechercher ou créer une entité…"
                clearLabel="Aucune"
                createLabel="Créer l'entité"
              />
              {draft.entityName && !draft.entityId ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  LLM avait suggéré « {String(draft.entityName)} » — non trouvée. Tape pour la
                  créer.
                </p>
              ) : null}
            </Field>
            <Field label="Montant (€)" htmlFor="valueAmount">
              <Input
                id="valueAmount"
                inputMode="decimal"
                value={val("valueAmount")}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const num = raw === "" ? null : Number(raw.replace(",", "."));
                  patch({ valueAmount: Number.isFinite(num) ? num : null });
                }}
              />
            </Field>
          </div>
        );

      case "contact":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="firstName">
              <Input
                id="firstName"
                value={val("firstName")}
                onChange={(e) => patch({ firstName: e.target.value })}
              />
            </Field>
            <Field label="Nom" htmlFor="lastName">
              <Input
                id="lastName"
                value={val("lastName")}
                onChange={(e) => patch({ lastName: e.target.value })}
              />
            </Field>
            <Field label="E-mail" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={val("email")}
                onChange={(e) => patch({ email: e.target.value || null })}
              />
            </Field>
            <Field label="Poste" htmlFor="jobTitle">
              <Input
                id="jobTitle"
                value={val("jobTitle")}
                onChange={(e) => patch({ jobTitle: e.target.value || null })}
              />
            </Field>
            <Field className="sm:col-span-2" label="Entité" htmlFor="entityId">
              <FkCombobox
                id="entityId"
                value={val("entityId") || null}
                onValueChange={(id) => {
                  const ent = id ? options.entities.find((e) => e.id === id) : null;
                  patch({ entityId: id, entityName: ent?.name ?? null });
                }}
                onCreate={async (name) => {
                  const res = await quickCreateEntity({ name });
                  if (!res.ok) return null;
                  patch({ entityId: res.data.id, entityName: res.data.name });
                  return { id: res.data.id, label: res.data.name };
                }}
                options={options.entities.map((e) => ({ id: e.id, label: e.name }))}
                placeholder="— Aucune —"
                searchPlaceholder="Rechercher ou créer une entité…"
                clearLabel="Aucune"
                createLabel="Créer l'entité"
              />
              {draft.entityName && !draft.entityId ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  LLM avait suggéré « {String(draft.entityName)} » — non trouvée. Tape pour la
                  créer.
                </p>
              ) : null}
            </Field>
          </div>
        );

      case "entity":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Nom" htmlFor="name">
              <Input
                id="name"
                value={val("name")}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Type" htmlFor="kind">
              <select
                id="kind"
                value={val("kind") || "prospect"}
                onChange={(e) => patch({ kind: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="client">Client</option>
                <option value="prospect">Prospect</option>
                <option value="partner">Partenaire</option>
                <option value="supplier">Fournisseur</option>
                <option value="other">Autre</option>
              </select>
            </Field>
          </div>
        );
    }
  }
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ─── Multi-assignee field for task editor ───────────────────────────────

type StoredAssignee = { kind: "user" | "contact"; id: string };

function readAssignees(draft: Record<string, unknown>): StoredAssignee[] {
  const raw = draft.assignees;
  if (!Array.isArray(raw)) {
    // Legacy mono-assignee (issu du LLM ou d'une ancienne payload).
    const uid = (draft.assigneeId as string | null | undefined) ?? null;
    const cid = (draft.assigneeContactId as string | null | undefined) ?? null;
    if (uid) return [{ kind: "user", id: uid }];
    if (cid) return [{ kind: "contact", id: cid }];
    return [];
  }
  return raw
    .filter(
      (a): a is StoredAssignee =>
        !!a &&
        typeof a === "object" &&
        (a as StoredAssignee).kind !== undefined &&
        typeof (a as StoredAssignee).id === "string",
    )
    .map((a) => ({ kind: a.kind, id: a.id }));
}

function TaskAssigneesField({
  draft,
  onPatch,
  options,
}: {
  draft: Record<string, unknown>;
  onPatch: (partial: Record<string, unknown>) => void;
  options: LinkOptions;
}) {
  const stored = readAssignees(draft);
  // Hydrate en refs enrichies (fullName/entityName/avatarUrl) pour le picker.
  const value: AssigneeRef[] = stored
    .map((a) => {
      if (a.kind === "user") {
        const u = options.users.find((x) => x.id === a.id);
        if (!u) return null;
        return {
          kind: "user" as const,
          id: u.id,
          fullName: u.fullName,
          avatarUrl: u.avatarUrl ?? null,
        };
      }
      const c = options.contacts.find((x) => x.id === a.id);
      if (!c) return null;
      return {
        kind: "contact" as const,
        id: c.id,
        fullName: c.fullName,
        entityName: c.entityName ?? null,
      };
    })
    .filter((x): x is AssigneeRef => x !== null);

  function handleChange(next: AssigneeRef[]) {
    // Écrit un tableau minimal { kind, id } dans le payload — les
    // fullName/entityName sont ré-hydratés à chaque render depuis options.
    const minimal: StoredAssignee[] = next.map((a) => ({ kind: a.kind, id: a.id }));
    onPatch({
      assignees: minimal,
      // Nettoie les champs legacy pour éviter les états incohérents à
      // l'acceptation côté serveur.
      assigneeId: null,
      assigneeContactId: null,
      assigneeName: minimal.length > 0 ? undefined : null,
      assigneeKind: null,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-2">
      {value.length === 0 ? (
        <span className="text-[12px] text-muted-foreground">Personne</span>
      ) : (
        value.map((a) => (
          <span
            key={`${a.kind}:${a.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--ds-bg-app)] py-0.5 pr-2 pl-2 text-[12px]"
          >
            {a.fullName ?? "(sans nom)"}
            {a.kind === "contact" ? (
              <span className="text-[10px] text-[var(--ds-text-tertiary)]">externe</span>
            ) : null}
          </span>
        ))
      )}
      <div className="ml-auto">
        <AssigneesPicker
          value={value}
          onChange={handleChange}
          userOptions={options.users.map((u) => ({
            id: u.id,
            fullName: u.fullName,
            avatarUrl: u.avatarUrl ?? null,
          }))}
          contactOptions={options.contacts.map((c) => ({
            id: c.id,
            fullName: c.fullName,
            entityName: c.entityName ?? null,
          }))}
        />
      </div>
    </div>
  );
}

function AlreadyInDbRow({
  proposal,
  onChange,
}: {
  proposal: ProposalWithMatches;
  onChange: (next: ProposalWithMatches) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const payload = proposal.payload as Record<string, unknown>;
  const title = summaryFor(proposal, payload);
  const subtitle = matchedSubtitle(proposal, payload);
  const viewHref = matchedViewHref(proposal);

  function apply() {
    // Pour un pending matched, "valider" = appliquer le lien (posé le tag,
    // ou lier le contact/entité/projet). Pour category_tag / project_link
    // c'est l'action normale, pour contact/entity/project on utilise le
    // record existant sans re-créer.
    startTransition(async () => {
      const res = await acceptEmailProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({ ...proposal, status: "accepted", decidedAt: new Date() });
      toast.success(SUCCESS_MSG[proposal.kind]);
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectEmailProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({ ...proposal, status: "rejected", decidedAt: new Date() });
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
      {viewHref ? (
        <Link
          href={viewHref}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight size={12} weight="bold" />
          Voir
        </Link>
      ) : null}
      {proposal.kind === "category_tag" || proposal.kind === "project_link" ? (
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

// ─── Meta tags per kind ─────────────────────────────────────────────────

const PRIORITY_TINT: Record<string, { tint: "yellow" | "red" | "gray"; label: string }> = {
  urgent: { tint: "red", label: "Urgente" },
  high: { tint: "yellow", label: "Haute" },
  normal: { tint: "gray", label: "Normale" },
  low: { tint: "gray", label: "Basse" },
};

function formatDueDate(raw: string): string {
  try {
    const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

function ProposalMetaTags({
  proposal,
  payload,
}: {
  proposal: ProposalWithMatches;
  payload: Record<string, unknown>;
}) {
  switch (proposal.kind) {
    case "task": {
      const assigneeName = payload.assigneeName as string | null | undefined;
      const priority = payload.priority as string | null | undefined;
      const projectName =
        proposal.matchedProjectName ?? (payload.projectName as string | null | undefined);
      const dueDate = payload.dueDate as string | null | undefined;
      const prio = priority && priority !== "normal" ? PRIORITY_TINT[priority] : null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {assigneeName ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--ds-bg-app)] py-0.5 pr-2 pl-2 text-[12px] text-muted-foreground">
              <User size={11} weight="duotone" />
              {assigneeName}
            </span>
          ) : null}
          {prio ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[12px]"
              style={{
                background: `var(--ds-tint-${prio.tint}-bg)`,
                color: `var(--ds-tint-${prio.tint}-text)`,
              }}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: `var(--ds-tint-${prio.tint}-dot)` }}
              />
              {prio.label}
            </span>
          ) : null}
          {projectName ? (
            <span
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-[12px]"
              style={{
                background: "var(--ds-tint-mauve-bg)",
                color: "var(--ds-tint-mauve-text)",
              }}
            >
              <Folder size={13} weight="duotone" />
              {projectName}
            </span>
          ) : null}
          {dueDate ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <Calendar size={13} weight="duotone" className="text-[var(--ds-text-tertiary)]" />
              {formatDueDate(dueDate)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ds-text-tertiary)]">
              <CalendarX size={13} weight="duotone" />
              Pas d'échéance
            </span>
          )}
        </div>
      );
    }
    case "project": {
      const k = payload.kind as string | null | undefined;
      const entityName = payload.entityName as string | null | undefined;
      const value = payload.valueAmount as number | null | undefined;
      const stage = payload.pipelineStage as ExtractionMeta["pipelineStage"] | undefined;
      return (
        <div className="flex flex-wrap items-center gap-2">
          {k ? <Tint tint="blue" label={k} /> : null}
          {stage && stage !== "none" ? (
            <Tint tint={STAGE_STYLE[stage].tint} label={STAGE_STYLE[stage].label} />
          ) : null}
          {entityName ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Buildings size={13} weight="duotone" className="text-[var(--ds-text-tertiary)]" />
              pour {entityName}
            </span>
          ) : null}
          {value != null ? (
            <span className="font-semibold text-[12px] text-muted-foreground tabular-nums">
              {Number(value).toLocaleString("fr-FR")} €
            </span>
          ) : null}
        </div>
      );
    }
    case "contact": {
      const jobTitle = payload.jobTitle as string | null | undefined;
      const entityName = payload.entityName as string | null | undefined;
      const email = payload.email as string | null | undefined;
      return (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          {jobTitle ? (
            <span className="inline-flex items-center gap-1.5">
              <IdentificationBadge
                size={13}
                weight="duotone"
                className="text-[var(--ds-text-tertiary)]"
              />
              {jobTitle}
            </span>
          ) : null}
          {entityName ? (
            <>
              <span className="text-[var(--ds-text-tertiary)]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Buildings size={13} weight="duotone" className="text-[var(--ds-text-tertiary)]" />
                {entityName}
              </span>
            </>
          ) : null}
          {email ? (
            <>
              <span className="text-[var(--ds-text-tertiary)]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <EnvelopeSimple
                  size={13}
                  weight="duotone"
                  className="text-[var(--ds-text-tertiary)]"
                />
                {email}
              </span>
            </>
          ) : null}
        </div>
      );
    }
    case "entity": {
      const k = payload.kind as string | null | undefined;
      if (!k) return null;
      return <span className="text-[12px] text-muted-foreground">{k}</span>;
    }
    default:
      return null;
  }
}

// ─── Icons / labels / helpers ───────────────────────────────────────────

function KindIcon({ kind }: { kind: EmailKind }) {
  const props = {
    size: 16,
    weight: "duotone" as const,
    className: "flex-none text-[var(--ds-primary-500)]",
  };
  switch (kind) {
    case "task":
      return <ListChecks {...props} />;
    case "project":
    case "project_link":
      return <Briefcase {...props} />;
    case "contact":
      return <User {...props} />;
    case "entity":
      return <Buildings {...props} />;
    case "category_tag":
      return <Tag {...props} />;
    case "draft_reply":
      return <Reply {...props} />;
  }
}

const KIND_NEW_LABEL: Partial<Record<EmailKind, string>> = {
  task: "Nouvelle tâche",
  project: "Nouveau projet",
  contact: "Nouveau contact",
  entity: "Nouvelle entité",
};

function NewBadge({ kind }: { kind: EmailKind }) {
  const label = KIND_NEW_LABEL[kind];
  if (!label) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={{
        background: "var(--ds-tint-green-bg)",
        color: "var(--ds-tint-green-text)",
      }}
    >
      <PlusCircle size={11} weight="bold" />
      {label}
    </span>
  );
}

function MatchBadge({ confidence }: { confidence: number | null }) {
  const pct = confidence != null ? `${Math.round(confidence * 100)}%` : "—";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={{
        background: "var(--ds-tint-blue-bg)",
        color: "var(--ds-tint-blue-text)",
      }}
    >
      Match existant · {pct}
    </span>
  );
}

function Tint({
  tint,
  label,
  icon,
}: {
  tint: "blue" | "yellow" | "green" | "red" | "gray" | "mauve";
  label: string;
  icon?: "reply";
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-[12px]"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      {icon === "reply" ? <Reply size={11} weight="bold" /> : null}
      {label}
    </span>
  );
}

function CountPill({
  tint,
  label,
  dot,
  icon,
}: {
  tint: "yellow" | "green" | "red";
  label: string;
  dot?: boolean;
  icon?: "check" | "x";
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-[12px]"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      {dot ? (
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: `var(--ds-tint-${tint}-dot)` }}
        />
      ) : null}
      {icon === "check" ? <Check size={11} weight="bold" /> : null}
      {icon === "x" ? <X size={11} weight="bold" /> : null}
      {label}
    </span>
  );
}

function HoverRevealButton({
  tint,
  label,
  icon,
  onClick,
  disabled,
  ring,
}: {
  tint: "red" | "green";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ring?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="group/hr inline-flex items-center rounded-md px-2.5 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
        boxShadow: ring ? `inset 0 0 0 1px var(--ds-tint-${tint}-dot)` : undefined,
      }}
    >
      {icon}
      <span className="ml-0 inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-150 group-hover/hr:ml-1.5 group-hover/hr:max-w-[120px] group-hover/hr:opacity-100">
        {label}
      </span>
    </button>
  );
}

function BulkDecideButtons({
  pendingIds,
  onMarkAll,
}: {
  pendingIds: string[];
  onMarkAll: (status: "accepted" | "rejected") => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (pendingIds.length === 0) return null;

  function bulk(action: "accept" | "reject") {
    startTransition(async () => {
      let ok = 0;
      let fail = 0;
      for (const id of pendingIds) {
        const res =
          action === "accept"
            ? await acceptEmailProposal({ proposalId: id })
            : await rejectEmailProposal({ proposalId: id });
        if (res.ok) ok++;
        else fail++;
      }
      onMarkAll(action === "accept" ? "accepted" : "rejected");
      if (ok > 0) toast.success(`${ok} ${action === "accept" ? "validés" : "rejetés"}.`);
      if (fail > 0) toast.error(`${fail} échec(s).`);
      router.refresh();
    });
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => bulk("reject")}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
        style={{
          background: "var(--ds-tint-red-bg)",
          color: "var(--ds-tint-red-text)",
        }}
      >
        <X size={13} weight="bold" />
        Tout rejeter
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => bulk("accept")}
        className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
        style={{
          background: "var(--ds-tint-green-bg)",
          color: "var(--ds-tint-green-text)",
          boxShadow: "inset 0 0 0 1px var(--ds-tint-green-dot)",
        }}
      >
        <Check size={13} weight="bold" />
        Tout valider
      </button>
    </div>
  );
}

function groupByKind(
  items: ProposalWithMatches[],
): Partial<Record<EmailKind, ProposalWithMatches[]>> {
  const out: Partial<Record<EmailKind, ProposalWithMatches[]>> = {};
  for (const it of items) {
    const arr = out[it.kind] ?? [];
    arr.push(it);
    out[it.kind] = arr;
  }
  return out;
}

const SUCCESS_MSG: Record<EmailKind, string> = {
  task: "Tâche créée.",
  category_tag: "Tag appliqué.",
  project_link: "Lien projet ajouté.",
  entity_link: "Entité rattachée.",
  project_contact_link: "Contact rattaché au projet.",
  contact: "Contact créé.",
  entity: "Entité créée.",
  project: "Projet créé.",
  draft_reply: "Brouillon poussé dans Gmail.",
};

function summaryFor(p: ProposalWithMatches, payload: Record<string, unknown>): string {
  switch (p.kind) {
    case "task":
      return String(payload.title ?? "Sans titre");
    case "project":
      return String(payload.name ?? "Sans nom");
    case "project_link":
      return (
        (payload.suggestedProjectName as string | null) ??
        p.matchedProjectName ??
        String(payload.projectName ?? "Projet")
      );
    case "entity_link":
      return p.matchedEntityName ?? "Entité";
    case "project_contact_link":
      return "Rattacher le contact au projet";
    case "contact":
      return formatPersonName(
        payload.firstName as string | null,
        payload.lastName as string | null,
      );
    case "entity":
      return String(payload.name ?? "Sans nom");
    case "category_tag": {
      const name = String(payload.name ?? "");
      return p.matchedTagLabel ? (p.matchedTagLabel.split("/").pop() ?? name) : name;
    }
    case "draft_reply":
      return String(payload.subject ?? "Re:");
  }
}

function matchedSubtitle(p: ProposalWithMatches, payload: Record<string, unknown>): string {
  switch (p.kind) {
    case "task":
      return "tâche existante";
    case "project":
    case "project_link":
      return "projet existant";
    case "entity_link":
      return "entité existante";
    case "project_contact_link":
      return "rattachement contact ↔ projet";
    case "contact": {
      const job = payload.jobTitle as string | null | undefined;
      const ent = payload.entityName as string | null | undefined;
      return [job, ent].filter(Boolean).join(" · ") || "contact existant";
    }
    case "entity":
      return "entité existante";
    case "category_tag":
      return "catégorie existante";
    case "draft_reply":
      return "";
  }
}

function matchedViewHref(p: ProposalWithMatches): string | null {
  if (!p.matchedId) return null;
  switch (p.kind) {
    case "task":
      return `/taches/${p.matchedId}`;
    case "project":
    case "project_link":
      return `/projets/${p.matchedId}`;
    case "contact":
      return `/contacts/${p.matchedId}`;
    case "entity":
      return `/entites/${p.matchedId}`;
    default:
      return null;
  }
}
