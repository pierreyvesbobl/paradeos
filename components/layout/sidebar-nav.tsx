"use client";

import { cn } from "@/lib/utils";
import { Briefcase, Calculator, Clock, Home, Kanban, School, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  /**
   * Préfixes d'URL supplémentaires qui activent cet item (au-delà de `href`).
   * Utile quand des fiches détail vivent encore sous l'ancienne route :
   * ex. CRM (`/crm`) reste actif sur `/contacts/<id>` ou `/projets/pipeline`.
   */
  match?: string[];
};

type NavSection = {
  label?: string;
  items: NavItem[];
};

const sections: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: Home },
      { label: "Projets", href: "/projets", icon: Briefcase },
      {
        label: "Pipeline",
        href: "/crm/pipeline",
        icon: Kanban,
        match: ["/projets/pipeline"],
      },
      { label: "Time tracking", href: "/temps", icon: Clock },
      {
        label: "CRM",
        href: "/crm",
        icon: Users,
        match: ["/contacts", "/entites"],
      },
      { label: "Compta", href: "/compta", icon: Calculator },
      { label: "Coworking", href: "/coworking", icon: School },
    ],
  },
];

/**
 * Item actif = le préfixe (href ou `match`) qui matche le mieux le pathname
 * (longest-prefix), mappé vers le `href` de son item. Évite que `/projets`
 * s'allume sur `/projets/pipeline` (plus long, rattaché à CRM) tout en
 * activant `/projets` sur `/projets/<id>`, et `/` uniquement en exact.
 */
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const section of sections) {
    for (const item of section.items) {
      for (const prefix of [item.href, ...(item.match ?? [])]) {
        const matches =
          prefix === "/"
            ? pathname === "/"
            : pathname === prefix || pathname.startsWith(`${prefix}/`);
        if (matches && prefix.length > bestLen) {
          best = item.href;
          bestLen = prefix.length;
        }
      }
    }
  }
  return best;
}

export function SidebarNav() {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {sections.map((section, si) => (
        <div key={section.label ?? `section-${si}`} className={si > 0 ? "pt-2" : undefined}>
          {section.label ? (
            <p className="px-3 pt-1 pb-1 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {section.label}
            </p>
          ) : null}
          {section.items.map((item) => {
            const Icon = item.icon;
            const base = "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors";
            if (item.disabled) {
              return (
                <span
                  key={item.href}
                  className={cn(base, "cursor-not-allowed text-muted-foreground/60")}
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
                className={cn(
                  base,
                  item.href === active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
