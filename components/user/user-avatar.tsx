"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

export function UserAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: Size;
  className?: string;
}) {
  return (
    <Avatar
      className={cn("ring-1 ring-border", SIZE_CLASSES[size], className)}
      title={name ?? undefined}
      aria-label={name ?? "Utilisateur"}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className={cn(FALLBACK_TEXT[size], "font-semibold text-muted-foreground")}>
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
