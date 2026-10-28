"use client";

import { Check, CheckSquare, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { FkCombobox } from "@/components/inline/fk-combobox";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { decideCommitLink, linkTaskToCommit, unlinkTaskFromCommit } from "@/lib/actions/commits";
import type { CommitLinkRow } from "@/lib/db/queries/commits";
import { type TaskStatus, taskStatusLabels } from "@/lib/schemas/tasks";

type Props = {
  remote: string;
  sha: string;
  links: CommitLinkRow[];
  openTasks: { id: string; title: string }[];
};

/**
 * Sous un commit : les tâches qu'il livre (confirmées), les suggestions à
 * trancher, et la liaison manuelle. Confirmer termine la tâche.
 */
export function CommitTaskLinks({ remote, sha, links, openTasks }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const confirmed = links.filter((l) => l.status === "confirmed");
  const suggested = links.filter((l) => l.status === "suggested");

  function done(res: { ok: boolean; message?: string }, success?: string) {
    if (!res.ok) {
      toast.error(res.message ?? "Échec.");
      return;
    }
    if (success) toast.success(success);
    router.refresh();
  }

  function decide(id: string, decision: "confirm" | "reject") {
    startTransition(async () => {
      const res = await decideCommitLink({ id, decision });
      done(
        res,
        decision === "confirm"
          ? res.ok && res.data.statusChanged
            ? "Tâche terminée par ce commit."
            : "Lien confirmé."
          : undefined,
      );
    });
  }

  function link(taskId: string | null) {
    if (!taskId) return;
    startTransition(async () => {
      const res = await linkTaskToCommit({ taskId, remote, sha });
      done(res, res.ok && res.data.statusChanged ? "Tâche terminée par ce commit." : "Lien posé.");
    });
  }

  function unlink(taskId: string) {
    startTransition(async () => {
      done(await unlinkTaskFromCommit({ taskId, remote, sha }));
    });
  }

  const linkedIds = new Set(confirmed.map((l) => l.taskId));
  const options = openTasks
    .filter((t) => !linkedIds.has(t.id))
    .map((t) => ({ id: t.id, label: t.title }));

  if (confirmed.length === 0 && suggested.length === 0 && options.length === 0) return null;

  return (
    <div className="space-y-1 text-[12px]">
      {confirmed.map((l) => (
        <div key={l.id} className="flex items-center gap-1.5 text-muted-foreground">
          <CheckSquare className="size-3.5 shrink-0" />
          <Link href={`/taches/${l.taskId}`} className="min-w-0 truncate hover:text-foreground">
            {l.taskTitle}
          </Link>
          <span className="shrink-0 text-[11px] opacity-80">
            {taskStatusLabels[l.taskStatus as TaskStatus] ?? l.taskStatus}
          </span>
          {l.auto ? (
            <span
              className="shrink-0 rounded-sm px-1 py-0.5 text-[10px] uppercase tracking-wide"
              style={{ background: "var(--ds-tint-green-bg)", color: "var(--ds-tint-green-text)" }}
              title={`Confirmé automatiquement${typeof l.confidence === "number" ? ` (${Math.round(l.confidence * 100)} %)` : ""}${l.reason ? ` : ${l.reason}` : ""}`}
            >
              auto
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            disabled={pending}
            onClick={() => unlink(l.taskId)}
            aria-label="Retirer le lien"
            title="Retirer le lien : la tâche garde son statut"
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}

      {suggested.map((l) => (
        <div
          key={l.id}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1"
          style={{ background: "var(--ds-tint-yellow-bg)", color: "var(--ds-tint-yellow-text)" }}
          title={l.reason ?? undefined}
        >
          <span className="shrink-0 text-[11px]">Livre ?</span>
          <Link href={`/taches/${l.taskId}`} className="min-w-0 truncate hover:underline">
            {l.taskTitle}
          </Link>
          {typeof l.confidence === "number" ? (
            <span className="shrink-0 text-[11px] tabular-nums opacity-80">
              {Math.round(l.confidence * 100)} %
            </span>
          ) : null}
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            disabled={pending}
            onClick={() => decide(l.id, "confirm")}
            aria-label="Oui, ce commit livre cette tâche"
            title="Oui : la tâche passe en terminée"
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            disabled={pending}
            onClick={() => decide(l.id, "reject")}
            aria-label="Non, pas cette tâche"
            title="Non : la paire ne sera plus proposée"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}

      {options.length > 0 ? (
        <FkCombobox
          value={null}
          onValueChange={link}
          options={options}
          placeholder="Ce commit livre une tâche…"
          searchPlaceholder="Chercher une tâche ouverte…"
          clearLabel={null}
          disabled={pending}
          className="h-6 max-w-[280px] text-[11px]"
        />
      ) : null}
    </div>
  );
}
