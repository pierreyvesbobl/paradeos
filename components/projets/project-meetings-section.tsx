import { Badge } from "@/components/ui/badge";
import { getMeetingsForProject } from "@/lib/db/queries/meetings";
import { formatDate } from "@/lib/format";
import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";

const STATUS_LABEL: Record<string, string> = {
  ingested: "Importé",
  extracted: "Extrait",
  reviewed: "Validé",
  archived: "Archivé",
};

/**
 * Section "Meetings" sur la fiche projet : liste les meetings dont
 * `project_id` matche, avec date, résumé tronqué, badge status, et
 * compteur de propositions LLM en attente. Clic → fiche meeting.
 *
 * Pour les meetings ingérés depuis Drive, un lien vers le fichier
 * source est aussi exposé.
 */
export async function ProjectMeetingsSection({ projectId }: { projectId: string }) {
  const list = await getMeetingsForProject(projectId);

  if (list.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="font-medium text-foreground text-sm">Meetings</h3>
        <p className="text-muted-foreground text-xs italic">
          Aucun meeting rattaché. Les meetings importés via{" "}
          <Link href="/meetings/nouveau" className="underline hover:text-foreground">
            l'upload manuel
          </Link>{" "}
          ou la sync Drive auto seront listés ici une fois leur projet validé.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2.5">
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-foreground text-sm">
          Meetings <span className="text-muted-foreground text-xs">({list.length})</span>
        </h3>
      </header>
      <ul className="divide-y rounded-md border bg-background">
        {list.map((m) => {
          const summaryPreview = m.summary
            ? m.summary
                .replace(/[#*_`>]/g, "")
                .trim()
                .slice(0, 180)
            : null;
          return (
            <li key={m.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/meetings/${m.id}`}
                  className="min-w-0 flex-1 space-y-0.5 hover:underline"
                >
                  <p className="truncate font-medium text-sm">{m.title}</p>
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {m.occurredAt ? <span>{formatDate(m.occurredAt)}</span> : null}
                    {m.sourceLabel ? (
                      <span className="inline-flex items-center gap-0.5">
                        <FileText className="size-3" />
                        {m.sourceLabel}
                      </span>
                    ) : null}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  {m.pendingCount > 0 ? (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    >
                      {m.pendingCount} à valider
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-[10px]">
                    {STATUS_LABEL[m.status] ?? m.status}
                  </Badge>
                  {m.sourceDriveFileId ? (
                    <a
                      href={`https://drive.google.com/open?id=${m.sourceDriveFileId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="Ouvrir le transcript dans Drive"
                      aria-label="Ouvrir le transcript dans Drive"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
              {summaryPreview ? (
                <p className="mt-1.5 line-clamp-2 text-muted-foreground text-xs">
                  {summaryPreview}
                  {m.summary && m.summary.length > 180 ? "…" : ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
