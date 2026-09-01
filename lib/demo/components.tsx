"use client";

import { formatEuro, formatPersonName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Eye } from "@phosphor-icons/react";
import {
  demoAmount,
  demoCompanyName,
  demoContactName,
  demoEmail,
  demoProjectName,
} from "./anonymize";
import { useDemoMode } from "./context";

/**
 * Affiche le nom d'une entité (entreprise client/fournisseur). En mode démo,
 * remplace par un alias stable dérivé de l'id.
 */
export function EntityName({
  entity,
  fallback = "—",
  className,
}: {
  entity: { id: string; name?: string | null } | null | undefined;
  fallback?: string;
  className?: string;
}) {
  const demo = useDemoMode();
  if (!entity) return <span className={className}>{fallback}</span>;
  const text = demo ? demoCompanyName(entity.id) : (entity.name ?? fallback);
  return <span className={className}>{text}</span>;
}

/**
 * Affiche le nom complet d'un contact. En mode démo, remplace par un alias stable.
 */
export function ContactName({
  contact,
  fallback = "—",
  className,
}: {
  contact:
    | {
        id: string;
        firstName?: string | null;
        lastName?: string | null;
      }
    | null
    | undefined;
  fallback?: string;
  className?: string;
}) {
  const demo = useDemoMode();
  if (!contact) return <span className={className}>{fallback}</span>;
  if (demo) {
    const { firstName, lastName } = demoContactName(contact.id);
    return <span className={className}>{`${firstName} ${lastName}`}</span>;
  }
  const real = formatPersonName(contact.firstName, contact.lastName, "");
  return <span className={className}>{real || fallback}</span>;
}

/**
 * Affiche un email. En mode démo, remplace par `prenom.nom@demo.local` stable.
 */
export function EmailAddress({
  id,
  email,
  className,
}: {
  id: string;
  email?: string | null;
  className?: string;
}) {
  const demo = useDemoMode();
  const text = demo ? demoEmail(id) : (email ?? "");
  return <span className={className}>{text}</span>;
}

/**
 * Affiche le nom d'un projet. En mode démo, remplace par "Projet Démo NNN".
 */
export function ProjectName({
  project,
  className,
}: {
  project: { id: string; name?: string | null } | null | undefined;
  className?: string;
}) {
  const demo = useDemoMode();
  if (!project) return <span className={className}>—</span>;
  const text = demo ? demoProjectName(project.id) : (project.name ?? "—");
  return <span className={className}>{text}</span>;
}

const eurCompactFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/**
 * Affiche un montant en €. En mode démo, applique un facteur déterministe
 * (×0.7 à ×1.4) basé sur `demoId` pour rester cohérent ligne par ligne.
 * Si `demoId` est absent, le mode démo est sans effet.
 */
export function EuroAmount({
  value,
  demoId,
  compact = false,
  className,
  fallback = "—",
}: {
  value: number | null | undefined;
  demoId?: string | null;
  compact?: boolean;
  className?: string;
  fallback?: string;
}) {
  const demo = useDemoMode();
  if (value == null) return <span className={className}>{fallback}</span>;
  const v = demo && demoId ? demoAmount(demoId, value) : value;
  return (
    <span className={className}>{compact ? eurCompactFormatter.format(v) : formatEuro(v)}</span>
  );
}

/**
 * Wrapper qui floute son contenu en mode démo (texte libre type transcripts,
 * corps d'emails, notes). Le DOM contient toujours le vrai texte — c'est
 * volontaire : si on veut un blindage strict, ne pas envoyer le contenu
 * côté serveur du tout.
 */
export function DemoBlur({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const demo = useDemoMode();
  if (!demo) return <>{children}</>;
  return (
    <span className={cn("select-none blur-sm", className)} aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * Bandeau visuel monté dans la topbar quand le mode démo est actif.
 * Sert de rappel permanent que les données affichées sont anonymisées.
 */
export function DemoBanner() {
  const demo = useDemoMode();
  if (!demo) return null;
  return (
    <a
      href="/settings/demo"
      className="inline-flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1 font-medium text-orange-800 text-xs hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200 dark:hover:bg-orange-900"
      title="Données affichées anonymisées. Cliquer pour désactiver."
    >
      <Eye weight="bold" className="h-3.5 w-3.5" />
      Mode démo
    </a>
  );
}
