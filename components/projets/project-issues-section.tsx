import { ArrowSquareOut, ChatCircle, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { ProjectRepoRow } from "@/lib/db/queries/project-repos";
import { formatRelativeShort } from "@/lib/format";
import { listOpenIssues } from "@/lib/github/issues";
import { parseGithubRepo } from "@/lib/github/remote";

/**
 * Issues GitHub ouvertes des dépôts rattachés au projet, lues en direct
 * (cache de deux minutes). Rien n'est stocké côté Parade OS : c'est une
 * fenêtre sur le dépôt, pas un miroir. Les dépôts qui ne sont pas sur
 * github.com n'apparaissent pas ; sans dépôt GitHub, la section non plus.
 */
export async function ProjectIssuesSection({ repos }: { repos: ProjectRepoRow[] }) {
  const targets = repos
    .map((r) => ({ remote: r.remote, ref: parseGithubRepo(r.remote) }))
    .filter((t): t is { remote: string; ref: { owner: string; repo: string } } => t.ref !== null);
  if (targets.length === 0) return null;

  const results = await Promise.all(
    targets.map(async (t) => ({ ...t, result: await listOpenIssues(t.ref) })),
  );
  const total = results.reduce(
    (n, r) => n + (r.result.status === "ok" ? r.result.issues.length : 0),
    0,
  );

  return (
    <section className="space-y-3 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
            Issues GitHub
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Les issues ouvertes des dépôts rattachés, lues en direct sur GitHub.
          </p>
        </div>
        {total > 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {total} ouverte{total > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>

      {results.map((r) => (
        <div key={r.remote} className="space-y-1.5">
          {results.length > 1 ? (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <GithubLogo className="size-3.5" />
              {r.remote.replace(/^github\.com\//, "")}
            </p>
          ) : null}
          {r.result.status === "no_token" ? (
            <p className="text-muted-foreground text-xs italic">
              Aucun jeton GitHub enregistré. À poser dans{" "}
              <Link
                href="/settings/integrations?tab=api"
                className="underline hover:text-foreground"
              >
                Réglages, API & LLM
              </Link>
              .
            </p>
          ) : r.result.status === "error" ? (
            <p className="text-muted-foreground text-xs italic">{r.result.message}</p>
          ) : r.result.issues.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">Aucune issue ouverte.</p>
          ) : (
            <ul className="space-y-1">
              {r.result.issues.map((issue) => (
                <li
                  key={issue.number}
                  className="flex items-start justify-between gap-3 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <a
                      href={issue.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-w-0 items-baseline gap-1.5 hover:underline"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        #{issue.number}
                      </span>
                      <span className="truncate">{issue.title}</span>
                      <ArrowSquareOut className="size-3 shrink-0 self-center text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </a>
                    {issue.labels.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {issue.labels.map((label) => (
                          <span
                            key={label}
                            className="rounded-sm px-1.5 py-0.5 text-[10px]"
                            style={{
                              background: "var(--ds-tint-gray-bg)",
                              color: "var(--ds-tint-gray-text)",
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    {issue.assignees.length > 0 ? <span>{issue.assignees.join(", ")}</span> : null}
                    {issue.comments > 0 ? (
                      <span className="flex items-center gap-0.5">
                        <ChatCircle className="size-3" />
                        {issue.comments}
                      </span>
                    ) : null}
                    <span title={issue.updatedAt}>{formatRelativeShort(issue.updatedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
