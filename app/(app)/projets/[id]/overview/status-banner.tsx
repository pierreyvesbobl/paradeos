import { statusTone } from "@/app/(app)/projets/[id]/overview/status-pill";
import { ProjectTransitionButtons } from "@/app/(app)/projets/[id]/transition-button";
import { type ProjectStatus, projectStatusLabels } from "@/lib/schemas/projects";
import { FlowArrow, PlayCircle } from "@phosphor-icons/react/dist/ssr";

const DESCRIPTION: Partial<Record<ProjectStatus, string>> = {
  planning: "— cadrage en cours, pas encore lancé.",
  active: "— projet en cours de livraison.",
  on_hold: "— pause temporaire, à ré-arbitrer.",
  completed: "— livraison bouclée.",
  archived: "— archivé, plus d'action attendue.",
  not_started: "— pas encore démarré côté commercial.",
  to_follow_up: "— à relancer pour avancer.",
  awaiting_response: "— en attente d'un retour côté client.",
  won: "— signé, prêt à démarrer la delivery.",
  lost: "— deal perdu.",
};

/**
 * Bannière « Statut » de la Vue d'ensemble. Fond tinté selon le statut,
 * icône duotone, label, description discrète et actions de transition
 * (Repasser au pipeline, Démarrer la delivery, etc.) alignées à droite.
 */
export function StatusBanner({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const tone = statusTone(status);
  const description = DESCRIPTION[status] ?? "";

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
        <FlowArrow size={13} weight="duotone" />
        <span>Statut</span>
      </div>
      <div
        className={`flex items-center gap-3 rounded-[9px] border px-3.5 py-2.5 ${tone.bg}`}
        style={{ borderColor: "var(--ds-border)" }}
      >
        <PlayCircle size={20} weight="duotone" className={tone.text} />
        <span className={`font-medium text-[14px] ${tone.text}`}>
          {projectStatusLabels[status]}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">{description}</span>
        <span className="ml-auto">
          <ProjectTransitionButtons projectId={projectId} status={status} />
        </span>
      </div>
    </section>
  );
}
