import { cn } from "@/lib/utils";

type Props = {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Variant compact pour les sous-sections (padding/icône réduits, pas de bg). */
  compact?: boolean;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 text-center",
        compact ? "px-4 py-6" : "rounded-lg border border-dashed bg-card/50 px-6 py-12",
        className,
      )}
    >
      {Icon ? (
        compact ? (
          <Icon className="size-4 text-muted-foreground" />
        ) : (
          <div className="rounded-full bg-muted p-3 text-muted-foreground">
            <Icon className="size-5" />
          </div>
        )
      ) : null}
      <div className="space-y-1">
        <p className={cn(compact ? "text-muted-foreground text-sm" : "font-medium text-sm")}>
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "max-w-sm text-sm",
              compact ? "text-muted-foreground/80 text-xs" : "text-muted-foreground",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
