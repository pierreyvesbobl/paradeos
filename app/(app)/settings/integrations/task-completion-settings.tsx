"use client";

import {
  ArrowSquareOut,
  CheckCircle,
  EnvelopeOpen,
  Microphone,
  Power,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { setTaskAutocompleteEnabled } from "@/lib/actions/task-completions";

export type RecentCompletion = {
  id: string;
  source: "meeting" | "email";
  taskId: string | null;
  taskTitle: string;
  /** Faux si la tâche a été rouverte depuis (annulation ou geste manuel). */
  stillDone: boolean;
  evidence: string;
  decidedAt: string | null;
  sourceHref: string;
  sourceLabel: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export function TaskCompletionSettings({
  enabled,
  recent,
}: {
  enabled: boolean;
  recent: RecentCompletion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await setTaskAutocompleteEnabled({ enabled: !enabled });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        enabled
          ? "Les clôtures repassent en propositions à valider."
          : "Les clôtures certaines s'appliquent désormais sans clic.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={enabled ? "default" : "outline"}
          onClick={toggle}
          disabled={pending}
          className="gap-1.5"
          title={
            enabled ? "Repasser en validation manuelle" : "Clôturer sans clic quand c'est certain"
          }
        >
          <Power className="size-3.5" />
          {enabled ? "Clôture automatique activée" : "Clôture automatique désactivée"}
        </Button>
        <Link
          href="/inbox?kind=task_completion"
          className="text-muted-foreground text-xs underline"
        >
          Voir les clôtures à valider
        </Link>
      </div>

      {recent.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-[11px]">Dernières clôtures appliquées sans clic</p>
          <ul className="divide-y rounded border bg-background text-xs">
            {recent.map((r) => {
              const SourceIcon = r.source === "meeting" ? Microphone : EnvelopeOpen;
              return (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2">
                  <CheckCircle
                    weight="duotone"
                    className={`mt-0.5 size-4 shrink-0 ${r.stillDone ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {r.taskId ? (
                        <Link href={`/taches/${r.taskId}`} className="font-medium hover:underline">
                          {r.taskTitle}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.taskTitle}</span>
                      )}
                      {!r.stillDone ? (
                        <span className="text-muted-foreground"> · rouverte depuis</span>
                      ) : null}
                    </p>
                    {r.evidence ? (
                      <p
                        className="truncate text-[11px] text-muted-foreground italic"
                        title={r.evidence}
                      >
                        « {r.evidence} »
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={r.sourceHref}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:underline"
                    title={r.sourceLabel}
                  >
                    <SourceIcon className="size-3.5" />
                    <span className="max-w-40 truncate">{r.sourceLabel}</span>
                    <ArrowSquareOut className="size-3" />
                  </Link>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatDate(r.decidedAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Aucune clôture appliquée sans clic pour l'instant.
        </p>
      )}
    </div>
  );
}
