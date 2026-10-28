import { Kanban } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/empty-state";
import Link from "@/components/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listIssueTaskLinks, listSyncedRepos } from "@/lib/db/queries/issue-board";
import { listBoardIssues } from "@/lib/github/board";
import { BOARD_CLOSED_WINDOW_DAYS } from "@/lib/github/issue-board";
import { parseGithubRepo } from "@/lib/github/remote";
import { type BoardCard, IssueBoard } from "./issue-board";

type SearchParams = Promise<{ project?: string }>;

/**
 * Tableau des issues GitHub des dépôts suivis (case « Issues » cochée sur
 * la fiche projet). Lu en direct, rien n'est stocké : c'est la vue
 * « où en est le développement » du chantier besoin client → prod.
 */
export default async function IssueBoardPage({ searchParams }: { searchParams: SearchParams }) {
  const { project } = await searchParams;
  const allRepos = await listSyncedRepos();
  const projectsSynced = [...new Map(allRepos.map((r) => [r.projectId, r])).values()];
  const repos = project ? allRepos.filter((r) => r.projectId === project) : allRepos;
  const targets = repos
    .map((repo) => ({ repo, ref: parseGithubRepo(repo.remote) }))
    .filter(
      (t): t is { repo: (typeof repos)[number]; ref: { owner: string; repo: string } } =>
        t.ref !== null,
    );

  const [results, links] = await Promise.all([
    Promise.all(targets.map(async (t) => ({ ...t, result: await listBoardIssues(t.ref) }))),
    listIssueTaskLinks(targets.map((t) => t.repo.remote)),
  ]);
  const linkByKey = new Map(links.map((l) => [`${l.remote}#${l.number}`, l]));

  const cards: BoardCard[] = [];
  const problems: { remote: string; message: string }[] = [];
  let noToken = false;
  let pullRequestsUnavailable = false;
  for (const r of results) {
    if (r.result.status === "no_token") {
      noToken = true;
      continue;
    }
    if (r.result.status === "error") {
      problems.push({ remote: r.repo.remote, message: r.result.message });
      continue;
    }
    if (r.result.pullRequestsUnavailable) pullRequestsUnavailable = true;
    for (const issue of r.result.issues) {
      cards.push({
        issue,
        repo: r.repo,
        task: linkByKey.get(`${r.repo.remote}#${issue.number}`) ?? null,
      });
    }
  }
  const openCount = cards.filter((c) => c.issue.state === "open").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tâches"
        title="Développement"
        description={
          <>
            Les issues GitHub des dépôts suivis, rangées d'après ce que GitHub en dit : PR liée,
            assignation, fermeture. Les livrées restent {BOARD_CLOSED_WINDOW_DAYS} jours.
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/taches">Liste des tâches</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/taches/gantt">Gantt</Link>
            </Button>
          </>
        }
      />

      {projectsSynced.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <FilterChip href="/taches/issues" active={!project}>
            Tous les projets
          </FilterChip>
          {projectsSynced.map((p) => (
            <FilterChip
              key={p.projectId}
              href={`/taches/issues?project=${p.projectId}`}
              active={project === p.projectId}
            >
              {p.projectName}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {targets.length === 0 ? (
        <EmptyState
          icon={Kanban}
          title="Aucun dépôt suivi"
          description={
            <>
              Coche « Issues » sur un dépôt GitHub d'une fiche projet : ses issues apparaîtront ici,
              et ses tâches Fonctionnalité y seront projetées.
            </>
          }
          action={
            <Button variant="outline" asChild>
              <Link href="/projets">Voir les projets</Link>
            </Button>
          }
        />
      ) : noToken ? (
        <EmptyState
          icon={Kanban}
          title="Aucun jeton GitHub enregistré"
          description="Le tableau lit GitHub en direct : il lui faut un jeton."
          action={
            <Button variant="outline" asChild>
              <Link href="/settings/integrations?tab=api">Réglages, API & LLM</Link>
            </Button>
          }
        />
      ) : (
        <>
          {problems.length > 0 || pullRequestsUnavailable ? (
            <ul className="space-y-1 text-muted-foreground text-xs">
              {problems.map((p) => (
                <li key={p.remote}>
                  <span className="font-mono">{p.remote.replace(/^github\.com\//, "")}</span> :{" "}
                  {p.message}
                </li>
              ))}
              {pullRequestsUnavailable ? (
                <li>
                  Le jeton n'a pas « Pull requests : lecture » : les colonnes En cours et En revue
                  ne voient pas les PR, seulement les assignations.
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {openCount} ouverte{openCount > 1 ? "s" : ""} sur {targets.length} dépôt
            {targets.length > 1 ? "s" : ""}
          </p>
          <IssueBoard cards={cards} showRepo={targets.length > 1} />
        </>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-foreground px-2.5 py-0.5 text-background text-xs"
          : "rounded-full bg-(--ds-bg-hover) px-2.5 py-0.5 text-muted-foreground text-xs hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
