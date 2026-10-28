import { Kanban } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/empty-state";
import { BoardNotices, IssueBoard } from "@/components/issues/issue-board";
import Link from "@/components/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listSyncedRepos } from "@/lib/db/queries/issue-board";
import { loadBoardCards } from "@/lib/github/board-cards";
import { BOARD_CLOSED_WINDOW_DAYS } from "@/lib/github/issue-board";

type SearchParams = Promise<{ project?: string }>;

/**
 * Tableau des issues GitHub de tous les dépôts suivis (case « Issues »
 * cochée sur la fiche projet). Lu en direct, rien n'est stocké. La même
 * vue, par projet, est l'onglet Développement de la fiche projet.
 */
export default async function IssueBoardPage({ searchParams }: { searchParams: SearchParams }) {
  const { project } = await searchParams;
  const allRepos = await listSyncedRepos();
  const projectsSynced = [...new Map(allRepos.map((r) => [r.projectId, r])).values()];
  const repos = project ? allRepos.filter((r) => r.projectId === project) : allRepos;
  const load = await loadBoardCards(repos);
  const openCount = load.cards.filter((c) => c.issue.state === "open").length;

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

      {load.repoCount === 0 ? (
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
      ) : load.noToken ? (
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
          <BoardNotices load={load} />
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {openCount} ouverte{openCount > 1 ? "s" : ""} sur {load.repoCount} dépôt
            {load.repoCount > 1 ? "s" : ""}
          </p>
          <IssueBoard cards={load.cards} showRepo={load.repoCount > 1} showProject />
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
