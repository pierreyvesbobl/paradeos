import { ArrowSquareOut, EnvelopeOpen, Microphone } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { TaskSourceGroup } from "@/lib/db/queries/task-sources";
import { formatDate } from "@/lib/format";

const RELATION_LABEL: Record<TaskSourceGroup["excerpts"][number]["relation"], string> = {
  origin: "À l'origine de la tâche",
  mention: "Réévoquée",
  completion: "Donnée pour faite",
};

const RELATION_TINT: Record<TaskSourceGroup["excerpts"][number]["relation"], string> = {
  origin: "blue",
  mention: "mauve",
  completion: "green",
};

/**
 * Ce que le client et l'équipe ont dit de la tâche, mot pour mot, réunion
 * par réunion et mail par mail, dans l'ordre où le besoin s'est précisé.
 * C'est la matière d'un brief : la fiche la montre telle quelle. Ne rend
 * rien pour une tâche saisie à la main sans source.
 */
export function TaskSourcesSection({ sources }: { sources: TaskSourceGroup[] }) {
  if (sources.length === 0) return null;
  return (
    <section className="space-y-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium text-[17px]">Ce qui a été dit</h2>
        <p className="text-(--ds-text-tertiary) text-[12px]">
          {sources.length} source{sources.length > 1 ? "s" : ""}, passages verbatim
        </p>
      </div>
      <ol className="space-y-3">
        {sources.map((g) => {
          const Icon = g.source === "meeting" ? Microphone : EnvelopeOpen;
          // Une source ne porte en pratique qu'une relation ; s'il y en a
          // plusieurs, la plus forte l'emporte pour l'étiquette.
          const relation = g.excerpts.some((e) => e.relation === "origin")
            ? "origin"
            : g.excerpts.some((e) => e.relation === "completion")
              ? "completion"
              : "mention";
          return (
            <li
              key={g.key}
              className="rounded-xl border border-ds-border bg-ds-surface px-4 py-3.5"
            >
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                <Icon size={14} weight="duotone" className="shrink-0" />
                <span>
                  {g.source === "meeting" ? "Réunion" : "Mail"}
                  {g.occurredAt ? ` du ${formatDate(g.occurredAt)}` : ""}
                </span>
                <span className="text-(--ds-text-tertiary)">·</span>
                <Link
                  href={g.href}
                  className="min-w-0 truncate font-medium text-foreground hover:underline"
                >
                  {g.label}
                  <ArrowSquareOut size={11} className="ml-0.5 inline align-[-1px]" />
                </Link>
                <span
                  className="ml-auto inline-flex items-center rounded-md px-2 py-0.5 font-medium text-[11px]"
                  style={{
                    background: `var(--ds-tint-${RELATION_TINT[relation]}-bg)`,
                    color: `var(--ds-tint-${RELATION_TINT[relation]}-text)`,
                  }}
                >
                  {RELATION_LABEL[relation]}
                </span>
              </p>
              <ul className="mt-2.5 space-y-2">
                {g.excerpts.map((e) => {
                  const who = e.speaker ?? (g.source === "email" ? g.fromName : null);
                  return (
                    <li
                      // Les passages d'une source sont dédoublonnés en base : la citation identifie.
                      key={`${g.key}:${e.relation}:${e.quote}`}
                      className="border-ds-border border-l-2 pl-3 text-[13.5px] leading-relaxed"
                    >
                      <p className="text-foreground/90">« {e.quote} »</p>
                      {who ? (
                        <p className="mt-0.5 text-(--ds-text-tertiary) text-[11px]">{who}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
