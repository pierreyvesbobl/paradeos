import { type TaskPriority, taskPriorityLabels } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";

const PRIORITY_TINT: Record<TaskPriority, "gray" | "yellow" | "red"> = {
  low: "gray",
  medium: "gray",
  high: "yellow",
  urgent: "red",
};

const TINT_CLASS: Record<"gray" | "yellow" | "red", { bg: string; text: string; dot: string }> = {
  gray: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "bg-tint-gray-dot" },
  yellow: {
    bg: "bg-tint-yellow-bg",
    text: "text-tint-yellow-text",
    dot: "bg-tint-yellow-dot",
  },
  red: { bg: "bg-tint-red-bg", text: "text-tint-red-text", dot: "bg-tint-red-dot" },
};

export function PriorityPill({
  value,
  className,
}: {
  value: TaskPriority;
  className?: string;
}) {
  const tint = PRIORITY_TINT[value];
  const cls = TINT_CLASS[tint];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] font-medium text-xs",
        cls.bg,
        cls.text,
        className,
      )}
    >
      <span className={cn("size-[7px] rounded-full", cls.dot)} />
      {taskPriorityLabels[value]}
    </span>
  );
}
