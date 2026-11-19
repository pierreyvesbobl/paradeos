"use client";

import { CalendarCheck, Microphone, Power } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { setCalendarAutoTimeEnabled } from "@/lib/actions/calendar-time";

export type RecentCalendarEntry = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  projectId: string | null;
  projectName: string | null;
  reasons: string | null;
  meetingId: string | null;
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

const REASON_LABELS: Record<string, string> = {
  title_project: "nom du projet",
  attendees: "invités",
  client: "client (titre, invités ou domaine)",
  meeting: "réunion",
};

/** `title_project+attendees (1.6)` → « nom du projet, invités ». */
function describeReasons(raw: string | null): string {
  if (!raw) return "";
  const kinds = raw.replace(/\s*\(.*\)\s*$/, "").split("+");
  return kinds.map((k) => REASON_LABELS[k] ?? k).join(", ");
}

export function CalendarTimeSettings({
  enabled,
  recent,
}: {
  enabled: boolean;
  recent: RecentCalendarEntry[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await setCalendarAutoTimeEnabled({ enabled: !enabled });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        enabled
          ? "Les rendez-vous reconnus restent à imputer d'un clic."
          : "Les rendez-vous reconnus deviennent des créneaux sans clic.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={enabled ? "default" : "outline"}
          onClick={toggle}
          disabled={pending}
          className="gap-1.5"
          title={
            enabled
              ? "Laisser les rendez-vous reconnus à imputer d'un clic"
              : "Poser le créneau sans clic quand le rendez-vous est passé"
          }
        >
          <Power className="size-3.5" />
          {enabled ? "Créneaux automatiques activés" : "Créneaux automatiques désactivés"}
        </Button>
        <Link href="/temps" className="text-muted-foreground text-xs underline">
          Voir la grille de la semaine
        </Link>
      </div>

      {recent.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-[11px]">Derniers créneaux posés sans clic</p>
          <ul className="divide-y rounded border bg-background text-xs">
            {recent.map((r) => {
              const start = new Date(r.startAt);
              const end = new Date(r.endAt);
              return (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2">
                  <CalendarCheck
                    weight="duotone"
                    className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{r.title}</span>
                      {r.projectId && r.projectName ? (
                        <>
                          <span className="text-muted-foreground"> · </span>
                          <Link href={`/projets/${r.projectId}`} className="hover:underline">
                            {r.projectName}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {dateFmt.format(start)} · {timeFmt.format(start)}–{timeFmt.format(end)}
                      {r.reasons ? ` · ${describeReasons(r.reasons)}` : ""}
                    </p>
                  </div>
                  {r.meetingId ? (
                    <Link
                      href={`/meetings/${r.meetingId}`}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title="Réunion tenue sur ce créneau"
                    >
                      <Microphone weight="duotone" className="size-4" />
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs italic">
          Aucun créneau posé sans clic pour l'instant : la relève du calendrier passe toutes les
          quinze minutes.
        </p>
      )}
    </div>
  );
}
