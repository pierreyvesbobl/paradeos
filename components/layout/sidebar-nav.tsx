"use client";

import { cn } from "@/lib/utils";
import {
  Briefcase,
  Buildings,
  Calculator,
  Clock,
  EnvelopeSimple,
  Funnel,
  House,
  Microphone,
  type Icon as PhosphorIcon,
  Tray,
  Users,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  icon: PhosphorIcon;
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
      { label: "Dashboard", href: "/", icon: House },
      { label: "À traiter", href: "/inbox", icon: Tray },
      { label: "Projets", href: "/projets", icon: Briefcase },
      {
        label: "Pipeline",
        href: "/crm/pipeline",
        icon: Funnel,
        match: ["/projets/pipeline"],
      },
      { label: "Time tracking", href: "/temps", icon: Clock },
      { label: "Meetings", href: "/meetings", icon: Microphone },
      { label: "Emails", href: "/emails", icon: EnvelopeSimple },
      {
        label: "CRM",
        href: "/crm",
        icon: Users,
        match: ["/contacts", "/entites"],
      },
      { label: "Compta", href: "/compta", icon: Calculator },
      { label: "Coworking", href: "/coworking", icon: Buildings },
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

export function SidebarNav({ inboxCount = 0 }: { inboxCount?: number }) {
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
                  <Icon size={18} weight="duotone" />
                  {item.label}
                  <span className="ml-auto text-[10px] uppercase tracking-wider">soon</span>
                </span>
              );
            }
            const isActive = item.href === active;
            const showInboxBadge = item.href === "/inbox" && inboxCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  base,
                  isActive
                    ? "bg-primary-50 font-medium text-primary-900"
                    : "text-ds-text-muted hover:bg-ds-hover hover:text-ds-text",
                )}
              >
                <Icon
                  size={18}
                  weight="duotone"
                  className={cn("shrink-0", isActive ? "text-primary-700" : "text-primary-500")}
                />
                <span className="flex-1">{item.label}</span>
                {showInboxBadge ? (
                  <span
                    className={cn(
                      "inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0 font-mono font-semibold text-[10px] tabular-nums",
                      isActive ? "bg-primary-500 text-white" : "bg-ds-hover text-ds-text-tertiary",
                    )}
                  >
                    {inboxCount > 99 ? "99+" : inboxCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
