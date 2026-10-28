"use client";

import { GitBranch, MapTrifold, Plus, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RepoMovePicker } from "@/components/projets/repo-move-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { addProjectRepo, removeProjectRepo, setProjectRepoSync } from "@/lib/actions/project-repos";
import { setProjectRepoRoadmapPath } from "@/lib/actions/roadmap";
import type { ProjectRepoRow, RepoLinkChoice } from "@/lib/db/queries/project-repos";

type Props = {
  projectId: string;
  repos: ProjectRepoRow[];
  /** Projets vers lesquels déplacer chaque dépôt, indexés par remote. */
  choices: RepoLinkChoice[];
};

/**
 * Dépôts git du projet. Le mod Claude Code (claude-mod/) lit le remote de
 * la session et le résout ici pour imputer le temps au bon projet. On
 * accepte l'URL telle que `git remote -v` la donne : elle est normalisée
 * côté serveur.
 */
export function ProjectReposSection({ projectId, repos, choices }: Props) {
  const [value, setValue] = useState("");
  const choiceFor = new Map(choices.map((c) => [c.remote, c]));
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

  function toggleSync(repo: ProjectRepoRow, syncIssues: boolean) {
    startTransition(async () => {
      const res = await setProjectRepoSync({ id: repo.id, syncIssues });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        syncIssues
          ? "Les fonctionnalités de ce projet partiront en issues sur ce dépôt."
          : "Projection en issues coupée pour ce dépôt.",
      );
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
          Le temps passé dans Claude Code sur ces dépôts est imputé à ce projet. Un dépôt mal lié se
          déplace vers le bon projet, son activité suit. Sur un dépôt GitHub, « Issues » projette
          les tâches de type Fonctionnalité en issues, avec le brief tiré de ce qui a été dit. «
          Feuille de route » : le chemin du roadmap.json du dépôt, lu par Parade OS pour aligner les
          tâches sur l'avancement réel.
        </p>
      </div>

      {repos.length > 0 ? (
        <ul className="space-y-1">
          {repos.map((r) => (
            <li key={r.id} className="space-y-1.5 rounded-md border px-2.5 py-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
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
                <span className="flex shrink-0 items-center gap-1">
                  {r.remote.startsWith("github.com/") ? (
                    <label
                      htmlFor={`sync-${r.id}`}
                      className="mr-1 flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
                      title="Projeter les tâches Fonctionnalité de ce projet en issues GitHub"
                    >
                      <Checkbox
                        id={`sync-${r.id}`}
                        checked={r.syncIssues}
                        disabled={pending}
                        onCheckedChange={(v) => toggleSync(r, v === true)}
                      />
                      Issues
                    </label>
                  ) : null}
                  {choiceFor.get(r.remote) ? (
                    <RepoMovePicker
                      choice={choiceFor.get(r.remote) as RepoLinkChoice}
                      currentProjectId={projectId}
                      className="h-6 max-w-[200px] text-[11px]"
                    />
                  ) : null}
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
                </span>
              </div>
              {r.remote.startsWith("github.com/") ? (
                <RepoRoadmapPathField repo={r} disabled={pending} />
              ) : null}
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

/** Chemin du roadmap.json du dépôt ; vide = feuille de route non suivie. */
function RepoRoadmapPathField({ repo, disabled }: { repo: ProjectRepoRow; disabled: boolean }) {
  const [path, setPath] = useState(repo.roadmapPath ?? "");
  const [saving, startSaving] = useTransition();
  const router = useRouter();

  function save() {
    const next = path.trim();
    if (next === (repo.roadmapPath ?? "")) return;
    startSaving(async () => {
      const res = await setProjectRepoRoadmapPath({ id: repo.id, roadmapPath: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(next ? "Feuille de route suivie et relue." : "Feuille de route non suivie.");
      router.refresh();
    });
  }

  return (
    <label
      htmlFor={`roadmap-${repo.id}`}
      className="flex items-center gap-2 text-[11px] text-muted-foreground"
    >
      <MapTrifold className="size-3.5 shrink-0" />
      <span className="shrink-0">Feuille de route</span>
      <Input
        id={`roadmap-${repo.id}`}
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder="roadmap.json"
        className="h-6 font-mono text-[11px]"
        disabled={disabled || saving}
      />
    </label>
  );
}
