"use client";

import { Sparkle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FkCombobox } from "@/components/inline/fk-combobox";
import { addProjectRepo } from "@/lib/actions/project-repos";
import type { RepoLinkChoice } from "@/lib/db/queries/project-repos";

/**
 * Rattachement d'un dépôt dont l'activité Claude Code est arrivée sans
 * projet : aucun candidat net par le nom, ou plusieurs. Les candidats par
 * affinité viennent en tête, marqués ; le reste des projets ouverts suit.
 * Choisir impute aussi l'activité déjà poussée sous ce remote.
 */
export function RepoLinkPicker({ choice }: { choice: RepoLinkChoice }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string | null>(null);
  const router = useRouter();

  function pick(projectId: string | null) {
    if (!projectId) return;
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
          ? `Dépôt rattaché, ${n} segment${n > 1 ? "s" : ""} imputé${n > 1 ? "s" : ""}.`
          : "Dépôt rattaché.",
      );
      router.refresh();
    });
  }

  return (
    <FkCombobox
      value={value}
      onValueChange={pick}
      disabled={pending}
      placeholder="Rattacher à un projet…"
      searchPlaceholder="Projet…"
      clearLabel={null}
      className="h-7 max-w-[260px] text-xs"
      options={choice.options.map((o) => ({
        id: o.id,
        label: o.name,
        leading: o.suggested ? (
          <Sparkle className="size-3 text-muted-foreground" weight="fill" aria-label="Suggéré" />
        ) : undefined,
      }))}
    />
  );
}
