"use client";

import {
  refreshCalendarEvents,
  refreshCalendarList,
  toggleCalendarSync,
} from "@/lib/actions/calendar";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type CalendarRow = {
  id: string;
  calendarId: string;
  summary: string;
  isPrimary: boolean;
  backgroundColor: string | null;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
};

export function CalendarsList({ calendars }: { calendars: CalendarRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refreshList() {
    startTransition(async () => {
      const res = await refreshCalendarList({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`${res.data.count} calendrier(s) trouvé(s).`);
      router.refresh();
    });
  }

  function refreshEvents() {
    startTransition(async () => {
      const res = await refreshCalendarEvents({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Events synchronisés.");
      router.refresh();
    });
  }

  function toggle(id: string, enabled: boolean) {
    startTransition(async () => {
      const res = await toggleCalendarSync({ calendarId: id, enabled });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      // Refresh events sur le nouveau périmètre
      if (enabled) {
        await refreshCalendarEvents({});
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Active les calendriers à afficher dans le planning. Refresh auto toutes les 15 min.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refreshList}
            disabled={pending}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            Recharger la liste
          </button>
          <button
            type="button"
            onClick={refreshEvents}
            disabled={pending}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            Resync events
          </button>
        </div>
      </div>

      {calendars.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          Aucun calendrier — clique sur « Recharger la liste » après avoir connecté Google.
        </p>
      ) : (
        <ul className="divide-y rounded-md border bg-background">
          {calendars.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: c.backgroundColor ?? "#94a3b8" }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">
                  {c.summary}
                  {c.isPrimary ? (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      principal
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{c.calendarId}</p>
              </div>
              <label className="inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={c.syncEnabled}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                  disabled={pending}
                  aria-label={`Synchroniser ${c.summary}`}
                />
                <span className="relative h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-foreground peer-disabled:opacity-50" />
                <span className="-translate-y-1/2 absolute h-4 w-4 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-[18px]" />
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
