import { ArrowSquareOut, EnvelopeOpen, Microphone } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { TaskCompletionSource } from "@/lib/db/queries/task-completions";
import { formatDate } from "@/lib/format";

/**
 * Sous « Terminée le » : d'après quelle réunion ou quel mail la tâche a
 * été clôturée, avec la citation qui l'a justifié. Ne rend rien pour une
 * tâche fermée à la main.
 */
export function TaskCompletionSources({ sources }: { sources: TaskCompletionSource[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="space-y-2">
      {sources.map((s) => {
        const Icon = s.source === "meeting" ? Microphone : EnvelopeOpen;
        const who = s.auto
          ? "automatiquement"
          : s.decidedByName
            ? `validé par ${s.decidedByName}`
            : null;
        return (
          <li
            key={`${s.source}:${s.href}:${s.decidedAt?.toISOString() ?? ""}`}
            className="rounded-lg border border-ds-border bg-ds-app px-3 py-2 text-xs"
          >
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Icon size={13} weight="duotone" className="shrink-0" />
              <span>
                D'après {s.source === "meeting" ? "la réunion" : "le mail"}{" "}
                <Link href={s.href} className="font-medium text-foreground hover:underline">
                  {s.label}
                  <ArrowSquareOut size={11} className="ml-0.5 inline align-[-1px]" />
                </Link>
              </span>
            </p>
            {s.evidence ? (
              <p className="mt-1 text-foreground/80 italic" title={s.evidence}>
                « {s.evidence} »
              </p>
            ) : null}
            {s.decidedAt || who ? (
              <p className="mt-1 text-(--ds-text-tertiary) text-[11px]">
                {[s.decidedAt ? formatDate(s.decidedAt) : null, who].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
