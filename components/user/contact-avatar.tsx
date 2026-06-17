"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  xs: "size-5",
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
} as const;

const FALLBACK_TEXT = {
  xs: "text-[9px]",
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
} as const;

type Size = keyof typeof SIZE_CLASSES;

/**
 * Bulle d'assignée pour un contact externe (CRM, côté client). Même API
 * que `UserAvatar` côté taille/aria, mais teinte ambre pour marquer le
 * caractère externe au regard de l'équipe Paradeos. Pas de photo : on
 * n'a pas d'avatars pour les contacts en base.
 */
export function ContactAvatar({
  name,
  entityName,
  size = "sm",
  className,
}: {
  name: string | null | undefined;
  entityName?: string | null;
  size?: Size;
  className?: string;
}) {
  const title = name
    ? `${name}${entityName ? ` — ${entityName}` : ""} (externe)`
    : "Contact externe";
  return (
    <Avatar
      className={cn("ring-1 ring-amber-200 dark:ring-amber-900", SIZE_CLASSES[size], className)}
      title={title}
      aria-label={title}
    >
      <AvatarFallback
        className={cn(
          FALLBACK_TEXT[size],
          "bg-amber-100 font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        )}
      >
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function initialsFor(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}
