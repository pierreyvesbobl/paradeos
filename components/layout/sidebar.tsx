import {
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  Clock,
  Home,
  Mic,
  School,
  Sparkles,
  StickyNote,
  Users,
} from "lucide-react";
import Link from "next/link";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
};

const items: NavItem[] = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Entités", href: "/entites", icon: Building2 },
  { label: "Pipeline", href: "/projets/pipeline", icon: Sparkles },
  { label: "Projets", href: "/projets", icon: Briefcase },
  { label: "Tâches", href: "/taches", icon: CheckSquare },
  { label: "Planning", href: "/planning", icon: Calendar },
  { label: "Temps", href: "/temps", icon: Clock },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Meetings", href: "/meetings", icon: Mic },
  { label: "Coworking", href: "/coworking", icon: School },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="font-mono font-semibold text-sm tracking-tight">
          Parade OS
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const className =
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors";
          if (item.disabled) {
            return (
              <span
                key={item.href}
                className={`${className} cursor-not-allowed text-muted-foreground/60`}
              >
                <Icon className="size-4" />
                {item.label}
                <span className="ml-auto text-[10px] uppercase tracking-wider">soon</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${className} text-muted-foreground hover:bg-muted hover:text-foreground`}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-[11px] text-muted-foreground">Parade SAS — Lyon</div>
    </aside>
  );
}
