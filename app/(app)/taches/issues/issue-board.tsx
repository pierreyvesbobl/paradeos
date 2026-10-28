import {
  ArrowSquareOut,
  ChatCircle,
  CheckSquare,
  GitMerge,
  GitPullRequest,
} from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { IssueTaskLink, SyncedRepo } from "@/lib/db/queries/issue-board";
import { formatRelativeShort } from "@/lib/format";
import {
  BOARD_COLUMNS,
  type BoardColumn,
  type BoardIssue,
  type BoardPullRequest,
  type BoardTint,
  boardColumnHints,
  boardColumnLabels,
  boardColumnTints,
  groupByColumn,
} from "@/lib/github/issue-board";
import { PARADEOS_ISSUE_LABEL } from "@/lib/github/project-issue";
import type { TaskStatus } from "@/lib/schemas/tasks";
import { taskStatusLabels } from "@/lib/schemas/tasks";

export type BoardCard = {
  issue: BoardIssue;
  repo: SyncedRepo;
  task: IssueTaskLink | null;
};

function tintVars(tint: BoardTint) {
  return {
    background: `var(--ds-tint-${tint}-bg)`,
    color: `var(--ds-tint-${tint}-text)`,
    "--tint-dot": `var(--ds-tint-${tint}-dot)`,
  } as React.CSSProperties;
}

/**
 * Quatre colonnes déduites de GitHub (cf. `lib/github/issue-board.ts`),
 * sans glisser-déposer : on ne déplace pas une carte, on assigne l'issue,
 * on ouvre une PR ou on la ferme, et le tableau suit.
 */
export function IssueBoard({ cards, showRepo }: { cards: BoardCard[]; showRepo: boolean }) {
  const byUpdated = (a: BoardCard, b: BoardCard) =>
    b.issue.updatedAt.localeCompare(a.issue.updatedAt);
  const groups = groupByColumn([...cards].sort(byUpdated));
  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-2">
      <div className="flex items-start gap-4">
        {BOARD_COLUMNS.map((column) => (
          <Column key={column} column={column} cards={groups[column]} showRepo={showRepo} />
        ))}
      </div>
    </div>
  );
}

function Column({
  column,
  cards,
  showRepo,
}: {
  column: BoardColumn;
  cards: BoardCard[];
  showRepo: boolean;
}) {
  return (
    <section
      style={tintVars(boardColumnTints[column])}
      className="flex w-[300px] shrink-0 flex-col gap-2.5 rounded-xl p-2.5"
    >
      <header className="space-y-1 px-1 pt-0.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-6 flex-none items-center justify-center rounded-full bg-(--ds-bg-app) font-bold text-[12px] shadow-xs">
            {cards.length}
          </span>
          <h2 className="whitespace-nowrap font-semibold text-[15px] leading-none">
            {boardColumnLabels[column]}
          </h2>
        </div>
        <p className="text-[11px] opacity-70">{boardColumnHints[column]}</p>
      </header>
      {cards.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {cards.map((card) => (
            <Card
              key={`${card.repo.remote}#${card.issue.number}`}
              card={card}
              showRepo={showRepo}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PullRequestBadge({ pr }: { pr: BoardPullRequest }) {
  const Icon = pr.state === "MERGED" ? GitMerge : GitPullRequest;
  const suffix =
    pr.state === "MERGED"
      ? " fusionnée"
      : pr.state === "CLOSED"
        ? " fermée"
        : pr.isDraft
          ? " brouillon"
          : "";
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full bg-(--ds-bg-hover) px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground hover:text-foreground"
      title={`Pull request #${pr.number}${suffix}`}
    >
      <Icon className="size-3" />#{pr.number}
      {suffix ? <span className="opacity-80">{suffix}</span> : null}
    </a>
  );
}

function Card({ card, showRepo }: { card: BoardCard; showRepo: boolean }) {
  const { issue, repo, task } = card;
  const labels = issue.labels.filter((l) => l !== PARADEOS_ISSUE_LABEL);
  const when =
    issue.state === "closed" && issue.closedAt
      ? `fermée ${formatRelativeShort(issue.closedAt)}`
      : formatRelativeShort(issue.updatedAt);
  return (
    <li className="space-y-2.5 rounded-[10px] border border-border/70 bg-(--ds-bg-app) px-3 py-3 text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.04)]">
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block font-medium text-sm leading-snug hover:underline"
      >
        <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">#{issue.number}</span>
        {issue.title}
        <ArrowSquareOut className="ml-1 inline size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </a>

      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
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

      {task ? (
        <Link
          href={`/taches/${task.taskId}`}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          title={`Tâche Parade OS · ${taskStatusLabels[task.taskStatus as TaskStatus] ?? task.taskStatus}`}
        >
          <CheckSquare className="size-3.5 shrink-0" />
          <span className="truncate">{task.taskTitle}</span>
        </Link>
      ) : null}

      <div className="h-px bg-border/70" />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: repo.projectColor ?? "var(--ds-tint-gray-dot)" }}
          />
          <Link href={`/projets/${repo.projectId}`} className="truncate hover:text-foreground">
            {repo.projectName}
          </Link>
          {showRepo ? (
            <span className="truncate font-mono opacity-80">
              {repo.remote.replace(/^github\.com\/[^/]+\//, "")}
            </span>
          ) : null}
        </span>
        <span className="flex-1" />
        {issue.pullRequests.map((pr) => (
          <PullRequestBadge key={pr.number} pr={pr} />
        ))}
        {issue.assignees.length > 0 ? <span>{issue.assignees.join(", ")}</span> : null}
        {issue.comments > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <ChatCircle className="size-3" />
            {issue.comments}
          </span>
        ) : null}
        <span title={issue.updatedAt}>{when}</span>
      </div>
    </li>
  );
}
