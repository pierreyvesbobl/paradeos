import { formatRelativeShort } from "@/lib/format";
import {
  type ProjectKind,
  type ProjectStatus,
  projectKindLabels,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import Link from "next/link";

export type Person = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type ProjectRow = {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  color: string | null;
  entityName: string | null;
  lead: Person | null;
  members: Person[];
  activityAt: Date;
};

type StatusTone = {
  bg: string;
  text: string;
  dot: string;
  border: string;
};

/**
 * Statut → teinte de la pill. Les couleurs sont pilotées par les tokens
 * `--ds-tint-<family>` ; le fallback bordure suit le dot dilué.
 */
function statusTone(status: ProjectStatus): StatusTone {
  switch (status) {
    case "active":
    case "won":
      return {
        bg: "var(--ds-tint-green-bg)",
        text: "var(--ds-tint-green-text)",
        dot: "var(--ds-tint-green-dot)",
        border: "#CFE0CF",
      };
    case "planning":
    case "not_started":
      return {
        bg: "var(--ds-tint-gray-bg)",
        text: "var(--ds-tint-gray-text)",
        dot: "var(--ds-tint-gray-dot)",
        border: "var(--ds-border-strong)",
      };
    case "to_follow_up":
      return {
        bg: "var(--ds-tint-yellow-bg)",
        text: "var(--ds-tint-yellow-text)",
        dot: "var(--ds-tint-yellow-dot)",
        border: "#E7D699",
      };
    case "awaiting_response":
      return {
        bg: "var(--ds-tint-orange-bg)",
        text: "var(--ds-tint-orange-text)",
        dot: "var(--ds-tint-orange-dot)",
        border: "#E2C299",
      };
    case "lost":
      return {
        bg: "var(--ds-tint-red-bg)",
        text: "var(--ds-tint-red-text)",
        dot: "var(--ds-tint-red-dot)",
        border: "#E2B4B1",
      };
    case "on_hold":
      return {
        bg: "var(--ds-tint-gray-bg)",
        text: "var(--ds-tint-gray-text)",
        dot: "var(--ds-tint-gray-dot)",
        border: "var(--ds-border-strong)",
      };
    case "completed":
      return {
        bg: "var(--ds-tint-mauve-bg)",
        text: "var(--ds-tint-mauve-text)",
        dot: "var(--ds-tint-mauve-dot)",
        border: "#D4C9EA",
      };
    case "archived":
      return {
        bg: "var(--ds-tint-gray-bg)",
        text: "var(--ds-tint-gray-text)",
        dot: "var(--ds-tint-gray-dot)",
        border: "var(--ds-border-strong)",
      };
  }
}

const GRID_COLS = "1fr 100px 108px 116px 116px";
const FRESH_THRESHOLD_MS = 26 * 60 * 60 * 1000; // ~24h + un peu de marge

export function ResultsTable({ rows }: { rows: ProjectRow[] }) {
  const now = new Date();
  return (
    <div
      className="overflow-hidden rounded-[10px] border"
      style={{ borderColor: "var(--ds-border)" }}
    >
      <div
        className="grid items-center gap-3 border-b px-4 py-2"
        style={{
          gridTemplateColumns: GRID_COLS,
          background: "var(--ds-bg-surface)",
          borderColor: "var(--ds-border)",
        }}
      >
        <HeaderCell label="Projet" />
        <HeaderCell label="Type" />
        <HeaderCell label="Statut" />
        <HeaderCell label="Équipe" />
        <HeaderCell label="Activité" sortActive />
      </div>
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        const activityAge = now.getTime() - row.activityAt.getTime();
        const fresh = activityAge >= 0 && activityAge <= FRESH_THRESHOLD_MS;
        return (
          <Link
            key={row.id}
            href={`/projets/${row.id}`}
            className="group grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ds-bg-hover"
            style={{
              gridTemplateColumns: GRID_COLS,
              borderBottom: isLast ? undefined : "1px solid var(--ds-border)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="size-[9px] flex-none rounded-full"
                style={{ background: row.color ?? "var(--ds-border-strong)" }}
                aria-hidden="true"
              />
              <span className="truncate text-[14px]" style={{ color: "var(--ds-text)" }}>
                {row.name}
              </span>
            </div>
            <div className="justify-self-start">
              <TypeTag kind={row.kind} />
            </div>
            <div className="justify-self-start">
              <StatusPill status={row.status} />
            </div>
            <div>
              <TeamCluster lead={row.lead} members={row.members} />
            </div>
            <div
              className="inline-flex items-center gap-1.5 text-[12px]"
              style={{ color: "var(--ds-text-muted)" }}
            >
              {fresh ? (
                <span
                  className="size-[6px] flex-none rounded-full"
                  style={{ background: "var(--ds-tint-green-dot)" }}
                  aria-hidden="true"
                />
              ) : null}
              <span title={row.activityAt.toISOString()}>
                {formatRelativeShort(row.activityAt, now)}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function HeaderCell({ label, sortActive }: { label: string; sortActive?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold text-[11px] uppercase"
      style={{
        color: sortActive ? "var(--ds-primary-700)" : "var(--ds-text-muted)",
        letterSpacing: "0.02em",
      }}
    >
      {label}
      {sortActive ? <ArrowDownIcon /> : null}
    </span>
  );
}

function ArrowDownIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 3v10m0 0l4-4m-4 4L4 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TypeTag({ kind }: { kind: ProjectKind }) {
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px]"
      style={{
        borderColor: "var(--ds-border)",
        color: "var(--ds-text-muted)",
      }}
    >
      {projectKindLabels[kind]}
    </span>
  );
}

function StatusPill({ status }: { status: ProjectStatus }) {
  const tone = statusTone(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]"
      style={{
        borderColor: tone.border,
        color: tone.text,
        background: tone.bg,
      }}
    >
      <span
        className="size-[5px] rounded-full"
        style={{ background: tone.dot }}
        aria-hidden="true"
      />
      {projectStatusLabels[status]}
    </span>
  );
}

const MAX_AVATARS = 3;
const CIRCLE_SIZE = 22;

const TINTS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "mauve",
  "pink",
  "red",
] as const;

function tintOf(seed: string): (typeof TINTS)[number] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length] as (typeof TINTS)[number];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "??").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}

function TeamCluster({ lead, members }: { lead: Person | null; members: Person[] }) {
  const people: { person: Person; isLead: boolean }[] = [];
  if (lead) people.push({ person: lead, isLead: true });
  for (const m of members) {
    if (m.id === lead?.id) continue;
    people.push({ person: m, isLead: false });
  }

  if (people.length === 0) {
    return (
      <span className="text-[12px]" style={{ color: "var(--ds-text-tertiary)" }}>
        —
      </span>
    );
  }

  const shown = people.slice(0, MAX_AVATARS);
  const extra = people.length - shown.length;

  return (
    <div className="flex items-center pl-1.5">
      {shown.map(({ person, isLead }, i) => (
        <ClusterAvatar key={person.id} name={person.name ?? "?"} isLead={isLead} overlap={i > 0} />
      ))}
      {extra > 0 ? (
        <span
          className="inline-flex flex-none items-center justify-center rounded-full font-semibold text-[10px]"
          style={{
            width: CIRCLE_SIZE,
            height: CIRCLE_SIZE,
            background: "var(--ds-bg-hover)",
            color: "var(--ds-text-tertiary)",
            border: "2px solid var(--ds-bg-surface)",
            marginLeft: -6,
          }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function ClusterAvatar({
  name,
  isLead,
  overlap,
}: {
  name: string;
  isLead: boolean;
  overlap: boolean;
}) {
  const tint = tintOf(name);
  return (
    <span
      className="inline-flex flex-none items-center justify-center rounded-full font-bold text-[9px]"
      style={{
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE,
        marginLeft: overlap ? -6 : 0,
        border: isLead ? "2px solid var(--ds-primary-400)" : "2px solid var(--ds-bg-surface)",
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
      title={isLead ? `${name} (lead)` : name}
      aria-label={isLead ? `${name} (lead)` : name}
    >
      {initialsOf(name)}
    </span>
  );
}
