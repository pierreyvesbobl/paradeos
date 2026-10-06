import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardTask } from "../dashboard-tasks";

// ─── dates ───────────────────────────────────────────────────────────

export function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export const dayLabelFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export const hourFmt = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Bucket par rapport à aujourd'hui (string YYYY-MM-DD).
export function bucketFor(
  due: string | null,
  today: string,
  weekEnd: string,
): DashboardTask["bucket"] {
  if (!due) return "later";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= weekEnd) return "week";
  return "later";
}

export function dueLabelFor(due: string | null, today: string): string {
  if (!due) return "—";
  if (due === today) return "Auj.";
  return shortDateFmt.format(new Date(due));
}

// ─── couleurs projet ─────────────────────────────────────────────────

// 8 tints pour colorier les projets (skip gray).
const PROJECT_TINTS: string[] = [
  "var(--ds-tint-orange-dot)",
  "var(--ds-tint-blue-dot)",
  "var(--ds-tint-green-dot)",
  "var(--ds-tint-mauve-dot)",
  "var(--ds-tint-pink-dot)",
  "var(--ds-tint-yellow-dot)",
  "var(--ds-tint-brown-dot)",
  "var(--ds-tint-red-dot)",
];

export function projectTint(p: { id: string; color: string | null }): string {
  if (p.color && /^#[0-9a-fA-F]{6}$/.test(p.color)) return p.color;
  // hash id en index stable
  let h = 0;
  for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PROJECT_TINTS[h % PROJECT_TINTS.length] ?? "var(--ds-tint-blue-dot)";
}

export type StatusPill = { label: string; bg: string; text: string; dot: string };

export const FALLBACK_STATUS: StatusPill = {
  label: "Actif",
  bg: "var(--ds-tint-green-bg)",
  text: "var(--ds-tint-green-text)",
  dot: "var(--ds-tint-green-dot)",
};

export const STATUS_PILL: Record<string, StatusPill> = {
  planning: {
    label: "Planification",
    bg: "var(--ds-tint-blue-bg)",
    text: "var(--ds-tint-blue-text)",
    dot: "var(--ds-tint-blue-dot)",
  },
  active: {
    label: "Actif",
    bg: "var(--ds-tint-green-bg)",
    text: "var(--ds-tint-green-text)",
    dot: "var(--ds-tint-green-dot)",
  },
  to_follow_up: {
    label: "À relancer",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    dot: "var(--ds-tint-orange-dot)",
  },
  awaiting_response: {
    label: "En attente",
    bg: "var(--ds-tint-yellow-bg)",
    text: "var(--ds-tint-yellow-text)",
    dot: "var(--ds-tint-yellow-dot)",
  },
  on_hold: {
    label: "En pause",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
  not_started: {
    label: "Non démarré",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
};

export const RELANCE_STATUS_LABEL: Record<string, string> = {
  not_started: "Non démarré",
  to_follow_up: "À relancer",
  awaiting_response: "Proposition envoyée",
  won: "Signé",
  planning: "Planification",
  active: "Actif",
  on_hold: "En pause",
};

// ─── briques de mise en page ─────────────────────────────────────────

/**
 * En-tête commun des sections de la colonne droite. Rendu aussi dans les
 * fallbacks Suspense : le titre et l'icône sont connus avant les données,
 * la section ne « saute » donc pas quand son contenu arrive.
 */
export function SectionHeader({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {icon}
      <h2 className="font-semibold text-[16px] text-ds-text">{title}</h2>
      <span className="flex-1" />
      {right}
    </div>
  );
}

const ROW_IDS = ["r1", "r2", "r3", "r4", "r5"];

/** Liste bordée (agenda, relances, factures) en attente de ses lignes. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-ds-border">
      {ROW_IDS.slice(0, rows).map((id, i) => (
        <div
          key={id}
          className={`flex items-center gap-2.5 bg-ds-app px-3.5 py-3 ${i < rows - 1 ? "border-ds-border border-b" : ""}`}
        >
          <Skeleton className="size-[9px] flex-none rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Cartes projet en attente. */
export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {ROW_IDS.slice(0, count).map((id) => (
        <div key={id} className="rounded-[10px] border border-ds-border bg-ds-app p-4">
          <div className="mb-2.5 flex items-center gap-2.5">
            <Skeleton className="size-[11px] flex-none rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-4 w-16 rounded-md" />
          </div>
          <Skeleton className="mb-2.5 h-3 w-1/2" />
          <Skeleton className="h-[5px] w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

const KPI_IDS = ["k1", "k2", "k3", "k4"];

/** Bandeau des 4 indicateurs en attente. */
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
      {KPI_IDS.map((id) => (
        <div
          key={id}
          className="flex flex-col gap-2.5 rounded-[10px] border border-ds-border bg-ds-app px-4 py-3.5"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-7 w-16" />
          <div className="border-ds-border border-t pt-2">
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Panneau des tâches (colonne gauche) en attente. */
export function TasksSkeleton() {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <Skeleton className="size-4.5 rounded" />
        <Skeleton className="h-4 w-28" />
      </div>
      <ListSkeleton rows={5} />
    </section>
  );
}
