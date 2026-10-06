import { CalendarDots, MapPin, VideoCamera } from "@phosphor-icons/react/dist/ssr";
import { requireUser } from "@/lib/auth/server";
import { getCalendarEventsForRange } from "@/lib/db/queries/calendar";
import { DemoBlur } from "@/lib/demo/components";
import { endOfDay, hourFmt, SectionHeader, startOfDay } from "./shared";

export function AgendaSectionHeader({ count }: { count?: number }) {
  return (
    <SectionHeader
      icon={<CalendarDots weight="duotone" className="size-4.5 text-primary-500" />}
      title="Aujourd'hui"
      right={
        count !== undefined ? (
          <span className="text-ds-text-tertiary text-sm">{count} rendez-vous</span>
        ) : null
      }
    />
  );
}

export async function AgendaSection() {
  const authUser = await requireUser();
  const agendaRaw = await getCalendarEventsForRange(authUser.id, startOfDay(), endOfDay());

  const agenda = agendaRaw
    .filter((e) => !e.allDay)
    .slice(0, 4)
    .map((e) => {
      const isPhysical = !!e.location && !/visio|meet|zoom|http/i.test(e.location);
      const dot =
        e.calendarBackgroundColor && /^#[0-9a-fA-F]{6}$/.test(e.calendarBackgroundColor)
          ? e.calendarBackgroundColor
          : "var(--ds-primary-400)";
      return {
        id: e.id,
        time: hourFmt.format(e.startAt),
        title: e.summary ?? "Sans titre",
        meta: e.location || (e.calendarSummary ?? ""),
        dot,
        physical: isPhysical,
      };
    });

  return (
    <section>
      <AgendaSectionHeader count={agenda.length} />
      <div className="overflow-hidden rounded-[10px] border border-ds-border">
        {agenda.length === 0 ? (
          <div className="bg-ds-app px-3.5 py-4 text-ds-text-tertiary text-sm">
            Aucun rendez-vous aujourd'hui.
          </div>
        ) : (
          agenda.map((e, i) => (
            <div
              key={e.id}
              className={`flex items-center gap-3 bg-ds-app px-3.5 py-2.5 transition-colors hover:bg-ds-hover ${i < agenda.length - 1 ? "border-ds-border border-b" : ""}`}
            >
              <span className="w-[42px] flex-none font-mono text-ds-text-muted text-xs">
                {e.time}
              </span>
              <span
                className="w-[3px] flex-none self-stretch rounded-full"
                style={{ background: e.dot }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-ds-text text-sm">
                  <DemoBlur>{e.title}</DemoBlur>
                </div>
                {e.meta ? (
                  <div className="truncate text-ds-text-tertiary text-xs">
                    <DemoBlur>{e.meta}</DemoBlur>
                  </div>
                ) : null}
              </div>
              {e.physical ? (
                <MapPin weight="duotone" className="size-4 text-ds-text-tertiary" />
              ) : (
                <VideoCamera weight="duotone" className="size-4 text-ds-text-tertiary" />
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
