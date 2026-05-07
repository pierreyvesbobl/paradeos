"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { patchProject } from "@/lib/actions/projects";
import {
  COMMERCIAL_STATUSES,
  type ProjectStatus,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { ArrowLeft, ArrowRight, Trophy, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Transition = {
  /** Statut cible. */
  next: ProjectStatus;
  /** Libellé du bouton. */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "default" | "outline" | "ghost";
  /** Confirme avant exécution (transitions destructives). */
  confirm?: { title: string; description?: string };
  /** Toast affiché en cas de succès. */
  successMessage: string;
};

/**
 * Calcule les transitions disponibles depuis le statut courant.
 * - Phase commerciale (not_started/to_follow_up/awaiting_response) : on peut signer (won) ou marquer perdu.
 * - won : démarrer la delivery (active).
 * - lost : reprendre le deal.
 * - delivery (planning/active/...) : repasser au pipeline (rare, confirme).
 */
function transitionsFor(status: ProjectStatus): Transition[] {
  const isCommercialOpen =
    (COMMERCIAL_STATUSES as readonly string[]).includes(status) &&
    status !== "won" &&
    status !== "lost";
  if (isCommercialOpen) {
    return [
      {
        next: "won",
        label: "Marquer comme signé",
        icon: Trophy,
        variant: "default",
        successMessage: "Deal signé.",
      },
      {
        next: "lost",
        label: "Marquer perdu",
        icon: X,
        variant: "ghost",
        successMessage: "Deal marqué perdu.",
      },
    ];
  }
  if (status === "won") {
    return [
      {
        next: "active",
        label: "Démarrer la delivery",
        icon: ArrowRight,
        variant: "default",
        successMessage: "Delivery démarrée.",
      },
    ];
  }
  if (status === "lost") {
    return [
      {
        next: "to_follow_up",
        label: "Reprendre le deal",
        icon: ArrowLeft,
        variant: "outline",
        successMessage: "Deal repris en pipeline.",
      },
    ];
  }
  // Phase delivery
  return [
    {
      next: "to_follow_up",
      label: "Repasser au pipeline",
      icon: ArrowLeft,
      variant: "ghost",
      confirm: {
        title: "Repasser au pipeline ?",
        description:
          "Le projet retournera en phase commerciale (À relancer). Le temps déjà tracké sur la delivery est conservé.",
      },
      successMessage: "Repassé au pipeline.",
    },
  ];
}

type Props = {
  projectId: string;
  status: ProjectStatus;
};

export function ProjectTransitionButtons({ projectId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Transition | null>(null);
  const transitions = transitionsFor(status);

  function execute(t: Transition) {
    startTransition(async () => {
      const res = await patchProject({ id: projectId, status: t.next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(t.successMessage);
      setConfirming(null);
      router.refresh();
    });
  }

  if (transitions.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
        Statut : {projectStatusLabels[status]}
      </p>
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <Button
            key={t.next}
            type="button"
            variant={t.variant ?? "default"}
            size="sm"
            disabled={pending}
            onClick={() => (t.confirm ? setConfirming(t) : execute(t))}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </Button>
        ))}
      </div>
      {confirming?.confirm ? (
        <ConfirmDialog
          open={true}
          onOpenChange={(o) => (!o ? setConfirming(null) : null)}
          title={confirming.confirm.title}
          description={confirming.confirm.description}
          confirmLabel={confirming.label}
          variant="destructive"
          onConfirm={() => execute(confirming)}
          pending={pending}
        />
      ) : null}
    </div>
  );
}
