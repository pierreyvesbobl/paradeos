"use client";

import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FkCombobox } from "@/components/inline/fk-combobox";
import { addProjectRepo } from "@/lib/actions/project-repos";
import type { RepoLinkChoice } from "@/lib/db/queries/project-repos";

type Props = {
  choice: RepoLinkChoice;
  /** Projet actuel, retiré de la liste : on déplace, on ne confirme pas. */
  currentProjectId: string;
  className?: string;
};

/**
 * Déplace un dépôt déjà rattaché vers un autre projet. Un dépôt mal lié se
 * corrige ici, depuis la fiche projet ou depuis le rapport /temps, sans
 * passer par « détacher puis rattacher ailleurs » : l'activité Claude Code
 * imputée au mauvais projet suit le dépôt (cf. `linkRemote`).
 */
export function RepoMovePicker({ choice, currentProjectId, className }: Props) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string | null>(null);
  const router = useRouter();

  function move(projectId: string | null) {
    if (!projectId || projectId === currentProjectId) return;
    setValue(projectId);
    startTransition(async () => {
      const res = await addProjectRepo({ projectId, remote: choice.remote });
      if (!res.ok) {
        toast.error(res.message);
        setValue(null);
        return;
      }
      const n = res.data?.backfilled ?? 0;
      toast.success(
        n > 0
          ? `Dépôt déplacé, ${n} séance${n > 1 ? "s" : ""} Claude Code réimputée${n > 1 ? "s" : ""}.`
          : "Dépôt déplacé.",
      );
      setValue(null);
      router.refresh();
    });
  }

  return (
    <FkCombobox
      value={value}
      onValueChange={move}
      disabled={pending}
      placeholder="Déplacer vers…"
      searchPlaceholder="Projet…"
      clearLabel={null}
      className={className ?? "h-7 max-w-[260px] text-xs"}
      options={choice.options
        .filter((o) => o.id !== currentProjectId)
        .map((o) => ({
          id: o.id,
          label: o.name,
          leading: o.suggested ? (
            <Sparkle className="size-3 text-muted-foreground" weight="fill" aria-label="Suggéré" />
          ) : (
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
          ),
        }))}
    />
  );
}
