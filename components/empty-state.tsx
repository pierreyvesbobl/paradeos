import { cn } from "@/lib/utils";

type Props = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium text-sm">{title}</p>
        {description ? (
          <p className="max-w-sm text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
