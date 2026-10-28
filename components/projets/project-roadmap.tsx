import { GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { RoadmapItemLinks } from "@/components/projets/roadmap-item-links";
import { RoadmapSyncButton } from "@/components/projets/roadmap-sync-button";
import { getProjectRoadmaps, type ProjectRoadmapView } from "@/lib/db/queries/roadmap";
import { formatRelativeShort } from "@/lib/format";
import { roadmapStatusLabel, roadmapStatusTint } from "@/lib/roadmap/roadmap";

/**
 * La feuille de route du dépôt (`roadmap.json`), lue sur GitHub, avec les
 * tâches Parade OS rapprochées de chaque item. C'est l'état d'avancement
 * réel : Parade OS ne l'écrit jamais, il aligne ses tâches dessus.
 */
export async function ProjectRoadmap({ projectId }: { projectId: string }) {
  const views = await getProjectRoadmaps(projectId);
  if (views.length === 0) return null;
  return (
    <div className="space-y-6">
      {views.map((view) => (
        <RepoRoadmap
          key={view.repoId}
          view={view}
          projectId={projectId}
          showRemote={views.length > 1}
        />
      ))}
    </div>
  );
}

function RepoRoadmap({
  view,
  projectId,
  showRemote,
}: {
  view: ProjectRoadmapView;
  projectId: string;
  showRemote: boolean;
}) {
  const snapshot = view.snapshot;
  const pendingSuggestions = view.links.filter((l) => l.status === "suggested").length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
            Feuille de route
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {showRemote ? (
              <span className="flex items-center gap-1 font-mono">
                <GithubLogo className="size-3.5" />
                {view.remote.replace(/^github\.com\//, "")}
              </span>
            ) : null}
            <span className="font-mono">{view.path}</span>
            {view.snapshot ? (
              <span>
                lue {formatRelativeShort(view.snapshot.fetchedAt)}
                {view.snapshot.roadmap.updated
                  ? `, mise à jour dans le dépôt le ${view.snapshot.roadmap.updated}`
                  : ""}
              </span>
            ) : (
              <span>pas encore lue</span>
            )}
            {pendingSuggestions > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5"
                style={{
                  background: "var(--ds-tint-yellow-bg)",
                  color: "var(--ds-tint-yellow-text)",
                }}
              >
                {pendingSuggestions} suggestion{pendingSuggestions > 1 ? "s" : ""} à trancher
              </span>
            ) : null}
          </p>
        </div>
        <RoadmapSyncButton projectId={projectId} />
      </div>

      {!snapshot ? (
        <p className="text-muted-foreground text-sm italic">
          La feuille de route n'a pas encore été lue. « Relire » l'importe depuis GitHub ; le jeton
          doit avoir « Contents : lecture » sur ce dépôt.
        </p>
      ) : (
        snapshot.roadmap.epics.map((epic) => (
          <div key={epic.id} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">{epic.id}</span>
              <h3 className="font-semibold text-sm">{epic.name}</h3>
              {epic.goal ? (
                <span className="truncate text-[12px] text-muted-foreground">{epic.goal}</span>
              ) : null}
            </div>
            <ul className="space-y-1.5">
              {epic.items.map((item) => {
                const tint = roadmapStatusTint(item.status);
                const links = view.links.filter((l) => l.itemId === item.id);
                return (
                  <li
                    key={item.id}
                    className="space-y-1.5 rounded-[10px] border border-ds-border bg-ds-surface px-3 py-2"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px]"
                        style={{
                          background: `var(--ds-tint-${tint}-bg)`,
                          color: `var(--ds-tint-${tint}-text)`,
                        }}
                      >
                        {roadmapStatusLabel(snapshot.roadmap, item.status)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                            {item.id}
                          </span>
                          {item.title}
                          {item.prio ? (
                            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                              {item.prio}
                            </span>
                          ) : null}
                        </p>
                        {item.note ? (
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{item.note}</p>
                        ) : null}
                      </div>
                    </div>
                    <RoadmapItemLinks
                      remote={view.remote}
                      itemId={item.id}
                      confirmed={links.filter((l) => l.status === "confirmed")}
                      suggested={links.filter((l) => l.status === "suggested")}
                      openTasks={view.openTasks}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
