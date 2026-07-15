import { type ProjectStatus, projectStatusLabels } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";

/**
 * Palette (bg / text / dot) par statut projet. Aligne pipeline commercial
 * (jaune/orange/rouge/vert) et delivery (bleu/vert/gris/mauve neutre)
 * sur les tokens tint du DS.
 */
const STATUS_TONE: Record<
  ProjectStatus,
  { bg: string; text: string; dot: string; label?: string }
> = {
  not_started: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
  to_follow_up: {
    bg: "bg-tint-orange-bg",
    text: "text-tint-orange-text",
    dot: "bg-tint-orange-dot",
  },
  awaiting_response: {
    bg: "bg-tint-yellow-bg",
    text: "text-tint-yellow-text",
    dot: "bg-tint-yellow-dot",
  },
  won: { bg: "bg-tint-green-bg", text: "text-tint-green-text", dot: "bg-tint-green-dot" },
  lost: { bg: "bg-tint-red-bg", text: "text-tint-red-text", dot: "bg-tint-red-dot" },
  planning: { bg: "bg-tint-blue-bg", text: "text-tint-blue-text", dot: "bg-tint-blue-dot" },
  active: { bg: "bg-tint-green-bg", text: "text-tint-green-text", dot: "bg-tint-green-dot" },
  on_hold: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
  completed: { bg: "bg-tint-green-bg", text: "text-tint-green-text", dot: "bg-tint-green-dot" },
  archived: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
};

export function ProjectStatusPill({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-2.5 py-1 font-semibold text-[11px] uppercase tracking-[0.04em]",
        tone.bg,
        tone.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {projectStatusLabels[status]}
    </span>
  );
}

export function statusTone(status: ProjectStatus) {
  return STATUS_TONE[status];
}
