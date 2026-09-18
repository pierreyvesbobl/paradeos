"use client";

/**
 * Wrapper email du panneau de propositions partagé : ajoute au-dessus la
 * carte d'extraction IA (résumé, intent, étape pipeline) et le brouillon de
 * réponse suggéré, puis délègue les propositions CRM à `ProposalsPanel`
 * avec la source `email`.
 */

import { STAGE_STYLE } from "@/components/proposals/helpers";
import { ProposalsPanel } from "@/components/proposals/proposals-panel";
import type { LinkOptions, Proposal } from "@/components/proposals/types";
import { Tint } from "@/components/proposals/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EmailProposal } from "@/db/schema/gmail";
import { acceptEmailProposal, rejectEmailProposal } from "@/lib/actions/email-proposals";
import type { ExtractionMeta } from "@/lib/gmail/queries";
import { ArrowBendUpLeft, PaperPlaneTilt, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * `category_tag` reste dans l'enum Postgres pour les propositions
 * historiques, mais n'a plus de surface : la taxonomie libre a disparu.
 */
type EmailKind = Exclude<EmailProposal["kind"], "category_tag">;

export type EmailProposalWithMatches = Omit<EmailProposal, "kind"> & {
  kind: EmailKind;
  matchedProjectName: string | null;
  matchedContactName: string | null;
  matchedEntityName: string | null;
};

type Props = {
  proposals: EmailProposalWithMatches[];
  extractionMeta: ExtractionMeta | null;
  extractionStatus: string;
  linkedProjectStatus: string | null;
  linkedProjectName: string | null;
  options: LinkOptions;
};

export function EmailProposalsPanel({
  proposals,
  extractionMeta,
  extractionStatus,
  linkedProjectStatus,
  linkedProjectName,
  options,
}: Props) {
  // Le brouillon de réponse est un CTA principal au-dessus des propositions
  // CRM ; il ne passe jamais par le panneau partagé.
  const serverDraft = proposals.find((p) => p.kind === "draft_reply" && p.status === "pending");
  const [draftReply, setDraftReply] = useState(serverDraft);
  useEffect(() => {
    setDraftReply(serverDraft);
  }, [serverDraft]);

  // Mémoïsé : le panneau resynchronise son état local sur l'identité du
  // tableau, un nouveau tableau à chaque render écraserait ses mises à jour
  // optimistes.
  const crmProposals = useMemo<Proposal[]>(
    () => proposals.filter((p) => p.kind !== "draft_reply"),
    [proposals],
  );

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
        <DraftReplySection proposal={draftReply} onDecided={() => setDraftReply(undefined)} />
      ) : null}

      <ProposalsPanel source="email" proposals={crmProposals} options={options} />
    </div>
  );
}

// ─── Carte d'extraction (résumé + intent + stage + needsReply) ──────────

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

// ─── Brouillon de réponse, en tête ──────────────────────────────────────

function DraftReplySection({
  proposal,
  onDecided,
}: {
  proposal: EmailProposalWithMatches;
  onDecided: () => void;
}) {
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
      onDecided();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectEmailProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onDecided();
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-[var(--ds-tint-blue-bg)] px-4 py-3">
        <ArrowBendUpLeft size={16} weight="duotone" className="text-[var(--ds-tint-blue-text)]" />
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
