"use client";

/**
 * Wrapper email du panneau de propositions partagé : ajoute au-dessus la
 * carte d'extraction IA (résumé, intent, étape pipeline), puis délègue les
 * propositions CRM à `ProposalsPanel` avec la source `email`.
 */

import { Sparkle } from "@phosphor-icons/react";
import { useMemo } from "react";
import { STAGE_STYLE } from "@/components/proposals/helpers";
import { ProposalsPanel } from "@/components/proposals/proposals-panel";
import type { LinkOptions, Proposal } from "@/components/proposals/types";
import { Tint } from "@/components/proposals/ui";
import type { EmailProposal } from "@/db/schema/gmail";
import type { ExtractionMeta } from "@/lib/gmail/queries";

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
  // Mémoïsé : le panneau resynchronise son état local sur l'identité du
  // tableau, un nouveau tableau à chaque render écraserait ses mises à jour
  // optimistes. Les brouillons de réponse historiques (`draft_reply`, plus
  // générés) n'ont plus de surface : ils expirent avec le reste.
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
        <Sparkle size={16} weight="duotone" className="text-(--ds-primary-500)" />
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
