import { BoardNotices, IssueBoard } from "@/components/issues/issue-board";
import Link from "@/components/link";
import { listSyncedRepos } from "@/lib/db/queries/issue-board";
import { loadBoardCards } from "@/lib/github/board-cards";
import { BOARD_CLOSED_WINDOW_DAYS } from "@/lib/github/issue-board";

/**
 * Onglet Développement de la fiche projet : le tableau des issues des
 * dépôts suivis de ce projet. Rendu seulement si un dépôt GitHub a la case
 * « Issues » cochée (cf. page parent).
 */
export async function ProjectIssueBoard({ projectId }: { projectId: string }) {
  const repos = await listSyncedRepos(projectId);
  const load = await loadBoardCards(repos);
  const openCount = load.cards.filter((c) => c.issue.state === "open").length;

  if (load.noToken) {
    return (
      <p className="text-muted-foreground text-sm italic">
        Aucun jeton GitHub enregistré. À poser dans{" "}
        <Link href="/settings/integrations?tab=api" className="underline hover:text-foreground">
          Réglages, API & LLM
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Les issues GitHub du projet, rangées d'après ce que GitHub en dit : PR liée, assignation,
          fermeture. Les livrées restent {BOARD_CLOSED_WINDOW_DAYS} jours.
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {openCount} ouverte{openCount > 1 ? "s" : ""}
          {load.repoCount > 1 ? ` sur ${load.repoCount} dépôts` : ""}
        </p>
      </div>
      <BoardNotices load={load} />
      <IssueBoard cards={load.cards} showRepo={load.repoCount > 1} showProject={false} />
    </div>
  );
}
