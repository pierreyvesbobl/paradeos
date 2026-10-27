"use client";

import { ArrowSquareOut, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { projectTaskIssue } from "@/lib/actions/task-issues";
import type { TaskKind } from "@/lib/tasks/task-kind";

type Props = {
  taskId: string;
  kind: TaskKind | null;
  issue: { url: string; number: number; remote: string } | null;
  /** Un dépôt GitHub du projet projette les fonctionnalités en issues. */
  canProject: boolean;
};

/**
 * L'issue GitHub d'une tâche dans le rail : le lien si elle existe, le
 * bouton pour la créer ou la remettre à jour sinon. La projection est à
 * sens unique, le brief est reconstruit depuis la fiche à chaque poussée.
 */
export function TaskGithubIssueField({ taskId, kind, issue, canProject }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function push() {
    startTransition(async () => {
      const res = await projectTaskIssue({ id: taskId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const r = res.data;
      toast.success(
        r.status === "created"
          ? `Issue #${r.number} créée.`
          : r.status === "updated"
            ? `Issue #${r.number} mise à jour.`
            : `Issue #${r.number} déjà à jour.`,
      );
      router.refresh();
    });
  }

  if (issue) {
    return (
      <div className="space-y-2">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2 rounded-md bg-tint-blue-bg px-3 py-1.5 font-medium text-sm text-tint-blue-text hover:underline"
        >
          <GithubLogo size={14} />
          <span>#{issue.number}</span>
          <span className="truncate font-mono text-[11px] opacity-70">
            {issue.remote.replace(/^github\.com\//, "")}
          </span>
          <ArrowSquareOut size={12} className="opacity-0 group-hover:opacity-100" />
        </a>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          disabled={pending}
          onClick={push}
        >
          {pending ? "Mise à jour…" : "Repousser le brief"}
        </Button>
      </div>
    );
  }

  if (kind !== "feature") {
    return (
      <p className="text-[12px] text-muted-foreground">
        Seule une tâche de type « Fonctionnalité » devient une issue.
      </p>
    );
  }
  if (!canProject) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Aucun dépôt du projet ne projette ses fonctionnalités. À activer sur la fiche projet,
        section « Dépôts git ».
      </p>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2"
      disabled={pending}
      onClick={push}
    >
      <GithubLogo size={14} />
      {pending ? "Création…" : "Créer l'issue GitHub"}
    </Button>
  );
}
