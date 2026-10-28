import { GitCommit, TerminalWindow } from "@phosphor-icons/react/dist/ssr";
import { CommitTaskLinks } from "@/components/projets/commit-task-links";
import { CommitsSyncButton } from "@/components/projets/commits-sync-button";
import { getProjectCommits } from "@/lib/db/queries/commits";
import { formatDate, formatRelativeShort } from "@/lib/format";

/**
 * Les derniers commits des dépôts suivis du projet, avec la tâche que
 * chacun livre : ce qui a réellement été fait, par GitHub ou par le mod
 * Claude Code, rapproché des tâches venues des réunions et des mails.
 */
export async function ProjectCommits({ projectId }: { projectId: string }) {
  const view = await getProjectCommits(projectId);
  const pending = view.commits.reduce(
    (n, c) => n + c.links.filter((l) => l.status === "suggested").length,
    0,
  );
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
            Commits
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>
              Ce qui a été livré dans le dépôt, et la tâche que chaque commit réalise. Confirmer
              termine la tâche.
            </span>
            {pending > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5"
                style={{
                  background: "var(--ds-tint-yellow-bg)",
                  color: "var(--ds-tint-yellow-text)",
                }}
              >
                {pending} suggestion{pending > 1 ? "s" : ""} à trancher
              </span>
            ) : null}
          </p>
        </div>
        <CommitsSyncButton projectId={projectId} />
      </div>

      {view.commits.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          Aucun commit connu. « Relire » lit les trente derniers jours sur GitHub ; le mod Claude
          Code pousse ensuite les commits faits en session.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {view.commits.map((c) => (
            <li
              key={`${c.remote}#${c.sha}`}
              className="space-y-1.5 rounded-[10px] border border-ds-border bg-ds-surface px-3 py-2"
            >
              <div className="flex items-start gap-2">
                {c.source === "claude_code" ? (
                  <TerminalWindow
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Poussé par le mod Claude Code"
                  />
                ) : (
                  <GitCommit
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Lu sur GitHub"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {c.subject}
                      </a>
                    ) : (
                      c.subject
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span className="font-mono">{c.sha.slice(0, 7)}</span>
                    {view.multiRepo ? (
                      <span className="font-mono">
                        {c.remote.replace(/^github\.com\/[^/]+\//, "")}
                      </span>
                    ) : null}
                    {c.author ? <span>{c.author}</span> : null}
                    <span title={formatDate(c.committedAt)}>
                      {formatRelativeShort(c.committedAt)}
                    </span>
                  </p>
                </div>
              </div>
              <CommitTaskLinks
                remote={c.remote}
                sha={c.sha}
                links={c.links}
                openTasks={view.openTasks}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
