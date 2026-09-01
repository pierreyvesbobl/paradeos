"use client";

import { demoCompanyName, demoContactName } from "@/lib/demo/anonymize";
import { useDemoMode } from "@/lib/demo/context";
import { cn } from "@/lib/utils";

import { formatPersonName } from "@/lib/format";
const TINTS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "mauve",
  "pink",
  "red",
] as const;

type Tint = (typeof TINTS)[number];

const SIZE_CLASSES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-[34px] text-[12px]",
  lg: "size-10 text-sm",
} as const;

type Size = keyof typeof SIZE_CLASSES;

function hashTint(seed: string): Tint {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length] as Tint;
}

function initialsFor(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "??").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}

/**
 * Bulle d'avatar tintée par hash du `seed` (par défaut le nom). Sert pour
 * les listes type CRM contacts où l'on n'a pas de photo mais où l'on veut
 * un repère couleur stable par personne.
 */
export function HashedAvatar({
  name,
  seed,
  title,
  size = "md",
  className,
  demoKind,
  demoId,
}: {
  name: string | null | undefined;
  seed?: string | null;
  title?: string;
  size?: Size;
  className?: string;
  /** Si fourni et que le mode démo est on, remplace le nom utilisé pour les
   * initiales par l'alias correspondant. */
  demoKind?: "entity" | "contact";
  demoId?: string;
}) {
  const demo = useDemoMode();
  let displayName = name;
  if (demo && demoId) {
    if (demoKind === "entity") displayName = demoCompanyName(demoId);
    else if (demoKind === "contact") {
      const c = demoContactName(demoId);
      displayName = formatPersonName(c.firstName, c.lastName);
    }
  }
  const tint = hashTint(seed?.trim() || displayName?.trim() || "?");
  return (
    <span
      title={title ?? displayName ?? undefined}
      aria-hidden="true"
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full font-semibold",
        SIZE_CLASSES[size],
        className,
      )}
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      {initialsFor(displayName)}
    </span>
  );
}
