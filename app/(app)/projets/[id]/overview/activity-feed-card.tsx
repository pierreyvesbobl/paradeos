import type { ActivityItem, ActivityKind } from "@/app/(app)/projets/[id]/overview/activity-query";
import { formatRelativeShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  EnvelopeSimple,
  Flag,
  FlowArrow,
  ListChecks,
  Note as NoteIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

const KIND_STYLE: Record<
  ActivityKind,
  { bg: string; text: string; icon: React.ComponentType<{ size?: number; weight?: "duotone" }> }
> = {
  email: { bg: "bg-tint-blue-bg", text: "text-tint-blue-text", icon: EnvelopeSimple },
  note: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", icon: NoteIcon },
  task_created: { bg: "bg-tint-green-bg", text: "text-tint-green-text", icon: ListChecks },
  status_transition: { bg: "bg-tint-orange-bg", text: "text-tint-orange-text", icon: Flag },
};

/**
 * Timeline verticale « Activité ». Un badge tinté par événement (email
 * / note / tâche / transition), une ligne verticale de connexion, et
 * titre + meta avec timestamp relatif court.
 */
export function ActivityFeedCard({ items }: { items: ActivityItem[] }) {
  return (
    <section className="flex flex-1 flex-col gap-3 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <header className="flex items-center gap-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
        <FlowArrow size={13} weight="duotone" />
        <span>Activité</span>
        <span className="mx-2 h-px flex-1 bg-ds-border" />
        <span className="font-normal text-[11px] normal-case tracking-normal">Tout</span>
      </header>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Rien encore. Les emails liés, notes ajoutées et changements de statut apparaîtront ici.
        </p>
      ) : (
        <ol className="space-y-4">
          {items.map((item, i) => {
            const S = KIND_STYLE[item.kind];
            const Icon = S.icon;
            const isLast = i === items.length - 1;
            const inner = (
              <div className="flex-1 space-y-0.5">
                <p className="line-clamp-2 text-[13px] text-foreground">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {item.meta} · {formatRelativeShort(item.at)}
                </p>
              </div>
            );
            return (
              <li key={`${item.kind}:${item.at.toISOString()}:${i}`} className="flex gap-3">
                <div className="relative flex-none">
                  <div
                    className={cn(
                      "flex size-[30px] items-center justify-center rounded-full",
                      S.bg,
                    )}
                  >
                    <Icon size={15} weight="duotone" />
                  </div>
                  {isLast ? null : (
                    <span className="absolute inset-x-0 top-[30px] mx-auto h-full w-px bg-ds-border" />
                  )}
                </div>
                {item.href ? (
                  <Link href={item.href} className="flex-1 rounded-md hover:bg-ds-hover/60">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
