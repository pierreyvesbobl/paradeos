import { ProjDate } from "@/app/(app)/projets/[id]/inline-fields";
import { formatRelativeShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";

function fmtDateTimeOrDash(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return formatRelativeShort(date);
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Carte « Derniers échanges » : 2×2 cellules récap des dates critiques.
 * Toutes les colonnes projet sont éditables inline (dernier contact,
 * relance prévue, closing estimé). Le dernier mail est dérivé du feed
 * d'activité et reste read-only.
 */
export function RecentExchangesCard({
  projectId,
  lastContactDate,
  lastEmailAt,
  followUpDate,
  expectedCloseDate,
}: {
  projectId: string;
  lastContactDate: string | Date | null;
  lastEmailAt: Date | null;
  followUpDate: string | Date | null;
  expectedCloseDate: string | Date | null;
}) {
  return (
    <section className="space-y-3 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <header className="flex items-center gap-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
        <ChatCircleDots size={13} weight="duotone" />
        <span>Derniers échanges</span>
      </header>
      <div className="grid grid-cols-2 gap-2.5">
        <EditableCell label="Dernier contact">
          <ProjDate id={projectId} field="lastContactDate" value={toIsoOrNull(lastContactDate)} />
        </EditableCell>
        <ReadonlyCell label="Dernier mail" value={fmtDateTimeOrDash(lastEmailAt)} />
        <EditableCell label="Relance prévue">
          <ProjDate id={projectId} field="followUpDate" value={toIsoOrNull(followUpDate)} />
        </EditableCell>
        <EditableCell label="Closing estimé">
          <ProjDate
            id={projectId}
            field="expectedCloseDate"
            value={toIsoOrNull(expectedCloseDate)}
          />
        </EditableCell>
      </div>
    </section>
  );
}

function EditableCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg border border-ds-border bg-ds-app px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.05em]">{label}</p>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function ReadonlyCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-ds-border bg-ds-app px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.05em]">{label}</p>
      <p className={cn("text-[13px]", value === "—" ? "text-ds-text-tertiary" : "text-foreground")}>
        {value}
      </p>
    </div>
  );
}
