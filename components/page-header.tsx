import { cn } from "@/lib/utils";

type Props = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, className }: Props) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="space-y-1">
        {eyebrow ? (
          <p className="text-muted-foreground text-xs uppercase tracking-wider">{eyebrow}</p>
        ) : null}
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {description ? <div className="text-muted-foreground text-sm">{description}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
