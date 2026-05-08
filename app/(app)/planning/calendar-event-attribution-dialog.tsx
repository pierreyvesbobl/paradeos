"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { attributeCalendarEvent } from "@/lib/actions/calendar";
import { ExternalLink, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Project = { id: string; name: string };

export type AttributionDialogEvent = {
  calendarEventId: string;
  summary: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  htmlLink: string | null;
};

export function CalendarEventAttributionDialog({
  event,
  projects,
  onClose,
}: {
  event: AttributionDialogEvent;
  projects: Project[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects.slice(0, 20);
    return projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [query, projects]);

  function attribute(projectId: string) {
    startTransition(async () => {
      const res = await attributeCalendarEvent({
        calendarEventId: event.calendarEventId,
        projectId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Event attribué.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{event.summary ?? "Sans titre"}</DialogTitle>
          <DialogDescription>
            {formatRange(event.startAt, event.endAt)}
            {event.location ? ` · ${event.location}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="font-medium text-foreground text-sm">Attribuer à un projet</p>
          <div className="relative">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un projet…"
              // biome-ignore lint/a11y/noAutofocus: focus voulu à l'ouverture du dialog
              autoFocus
              disabled={pending}
              className="w-full rounded-md border bg-background py-1.5 pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-muted-foreground text-xs italic">
                Aucun projet
              </li>
            ) : (
              filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => attribute(p.id)}
                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {p.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <DialogFooter className="sm:justify-between">
          {event.htmlLink ? (
            <Button variant="ghost" size="sm" asChild>
              <a
                href={event.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1.5"
              >
                <ExternalLink className="size-3.5" />
                Voir dans Calendar
              </a>
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const dateFmt = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) {
    return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} → ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}
