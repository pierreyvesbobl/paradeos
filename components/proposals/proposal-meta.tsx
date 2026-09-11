"use client";

import { HashedAvatar } from "@/components/user/hashed-avatar";
import {
  Buildings,
  Calendar,
  CalendarX,
  EnvelopeSimple,
  Folder,
  IdentificationBadge,
  Warning,
} from "@phosphor-icons/react";
import { PRIORITY_TINT, type PipelineStage, STAGE_STYLE, formatDueDate } from "./helpers";
import type { Proposal } from "./types";
import { Tint } from "./ui";

/** Tags de contexte sous le titre d'une proposition, selon son kind. */
export function ProposalMetaTags({
  proposal,
  payload,
}: {
  proposal: Proposal;
  payload: Record<string, unknown>;
}) {
  switch (proposal.kind) {
    case "task": {
      const assigneeName = payload.assigneeName as string | null | undefined;
      const isExternal = !!payload.assigneeContactId || payload.assigneeKind === "external";
      const priority = payload.priority as string | null | undefined;
      const projectName =
        proposal.matchedProjectName ?? (payload.projectName as string | null | undefined);
      const dueDate = payload.dueDate as string | null | undefined;
      const prio = priority && priority !== "normal" ? PRIORITY_TINT[priority] : null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {assigneeName ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--ds-bg-app)] py-0.5 pr-2 pl-0.5 text-[12px] text-muted-foreground">
              <HashedAvatar name={assigneeName} seed={assigneeName} size="xs" />
              {assigneeName}
              {isExternal ? (
                <span className="text-[10px] text-[var(--ds-text-tertiary)]">externe</span>
              ) : null}
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
    case "project":
    case "opportunity": {
      const k = payload.kind as string | null | undefined;
      const entityName = payload.entityName as string | null | undefined;
      const value = payload.valueAmount as number | null | undefined;
      const stage = payload.pipelineStage as PipelineStage | undefined;
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
    case "project_link":
    case "entity_link":
    case "project_contact_link":
    case "draft_reply":
      return null;
  }
}

/**
 * Avertit d'un probable doublon entre projet et opportunité, quand
 * l'extraction a repéré un record similaire de l'autre kind. Piloté par
 * le payload uniquement : sans champ `related*`, ne rend rien.
 */
export function CrossKindBanner({
  proposal,
  payload,
}: {
  proposal: Proposal;
  payload: Record<string, unknown>;
}) {
  if (proposal.kind === "project") {
    const oppTitle = payload.relatedOpportunityTitle as string | null | undefined;
    const conf = payload.relatedOpportunityConfidence as number | null | undefined;
    if (!oppTitle) return null;
    return (
      <CrossKindNotice>
        Une opportunité similaire existe déjà : <strong>« {oppTitle} »</strong>
        {conf != null ? ` (${Math.round(conf * 100)}%)` : ""}. Vérifie qu'on ne crée pas un doublon
        — si l'opp est gagnée, convertis-la depuis sa fiche plutôt que de créer un projet ici.
      </CrossKindNotice>
    );
  }
  if (proposal.kind === "opportunity") {
    const projName = payload.relatedProjectName as string | null | undefined;
    const conf = payload.relatedProjectConfidence as number | null | undefined;
    if (!projName) return null;
    return (
      <CrossKindNotice>
        Un projet similaire existe déjà : <strong>« {projName} »</strong>
        {conf != null ? ` (${Math.round(conf * 100)}%)` : ""}. Probable doublon — cette affaire est
        peut-être déjà engagée comme projet.
      </CrossKindNotice>
    );
  }
  return null;
}

function CrossKindNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      <Warning weight="duotone" className="mt-0.5 size-3.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}
