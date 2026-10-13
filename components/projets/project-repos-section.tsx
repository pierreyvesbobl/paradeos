"use client";

import { GitBranch, Plus, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addProjectRepo, removeProjectRepo } from "@/lib/actions/project-repos";
import type { ProjectRepoRow } from "@/lib/db/queries/project-repos";

type Props = {
  projectId: string;
  repos: ProjectRepoRow[];
};

/**
 * Dépôts git du projet. Le mod Claude Code (claude-mod/) lit le remote de
 * la session et le résout ici pour imputer le temps au bon projet. On
 * accepte l'URL telle que `git remote -v` la donne : elle est normalisée
 * côté serveur.
 */
export function ProjectReposSection({ projectId, repos }: Props) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    const remote = value.trim();
    if (!remote) return;
    startTransition(async () => {
      const res = await addProjectRepo({ projectId, remote });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setValue("");
      toast.success(res.data ? `Dépôt ${res.data.remote} rattaché.` : "Dépôt rattaché.");
      router.refresh();
    });
  }

  function remove(repo: ProjectRepoRow) {
    startTransition(async () => {
      const res = await removeProjectRepo({ id: repo.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <div>
        <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
          Dépôts git
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Le temps passé dans Claude Code sur ces dépôts est imputé à ce projet.
        </p>
      </div>

      {repos.length > 0 ? (
        <ul className="space-y-1">
          {repos.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{r.remote}</span>
                {r.autoLinked ? (
                  <span
                    className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide"
                    title="Rattaché automatiquement d'après le nom du dépôt"
                  >
                    auto
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                disabled={pending}
                onClick={() => remove(r)}
                aria-label={`Détacher ${r.remote}`}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="git@github.com:owner/repo.git"
          className="h-8 font-mono text-xs"
          disabled={pending}
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending || !value.trim()}>
          <Plus className="size-3.5" />
          Ajouter
        </Button>
      </form>
    </section>
  );
}
