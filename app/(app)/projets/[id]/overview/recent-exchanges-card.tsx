import { formatDate, formatRelativeShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";

function fmtDateOrDash(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return formatDate(value);
}

function fmtDateTimeOrDash(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return formatRelativeShort(date);
}

/**
 * Carte « Derniers échanges » : 2×2 cellules récap des dates critiques
 * (dernier contact / dernier mail / relance / closing). Cellules sur
 * `bg-ds-app` (hairline) pour se distinguer de la surface parente.
 */
export function RecentExchangesCard({
  lastContactDate,
  lastEmailAt,
  followUpDate,
  expectedCloseDate,
}: {
  lastContactDate: string | Date | null;
  lastEmailAt: Date | null;
  followUpDate: string | Date | null;
  expectedCloseDate: string | Date | null;
}) {
  const cells = [
    { label: "Dernier contact", value: fmtDateOrDash(lastContactDate) },
    { label: "Dernier mail", value: fmtDateTimeOrDash(lastEmailAt) },
    { label: "Relance prévue", value: fmtDateOrDash(followUpDate) },
    { label: "Closing estimé", value: fmtDateOrDash(expectedCloseDate) },
  ];

  return (
    <section className="space-y-3 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <header className="flex items-center gap-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
        <ChatCircleDots size={13} weight="duotone" />
        <span>Derniers échanges</span>
      </header>
      <div className="grid grid-cols-2 gap-2.5">
        {cells.map((c) => (
          <div
            key={c.label}
            className="space-y-1 rounded-lg border border-ds-border bg-ds-app px-3 py-2.5"
          >
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.05em]">
              {c.label}
            </p>
            <p
              className={cn(
                "text-[13px]",
                c.value === "—" ? "text-ds-text-tertiary" : "text-foreground",
              )}
            >
              {c.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
