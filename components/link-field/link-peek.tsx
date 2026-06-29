"use client";

import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Briefcase,
  Buildings,
  EnvelopeSimple,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { LinkGlyph, type LinkItem } from "./link-chip";

const FIELD_ICON: Record<string, PhosphorIcon> = {
  entity: Buildings,
  email: EnvelopeSimple,
  meta: Briefcase,
};

export type PeekField = {
  /** Discriminant utilisé pour l'icône (entity / email / meta / …). */
  key: keyof typeof FIELD_ICON | string;
  label?: string;
  value: ReactNode;
};

/**
 * Carte d'aperçu au survol — ouvre après ~140ms de "settle", grace 140ms
 * sur le leave pour permettre au curseur de traverser. Conforme à la
 * description "hover peek" du handoff ChampLiaison.
 */
export function LinkPeek({
  item,
  fields,
  href,
  children,
  enabled = true,
  delayMs = 140,
}: {
  item: LinkItem;
  fields: PeekField[];
  href: string;
  children: ReactNode;
  enabled?: boolean;
  delayMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const enterTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
      if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
    };
  }, []);

  function handleEnter() {
    if (!enabled) return;
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    enterTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, delayMs);
  }

  function handleLeave() {
    if (enterTimerRef.current) {
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    leaveTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, delayMs);
  }

  if (!enabled) return <>{children}</>;

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      {children}
      {open ? (
        <div
          role="tooltip"
          className={cn(
            "absolute top-[calc(100%+8px)] left-0 z-50 w-[296px] rounded-[10px] border bg-popover text-popover-foreground",
            "shadow-[rgba(15,15,15,0.05)_0_0_0_1px,rgba(15,15,15,0.08)_0_3px_6px,rgba(15,15,15,0.12)_0_9px_24px]",
            "fade-in-0 slide-in-from-top-1 animate-in duration-150",
          )}
          onPointerEnter={() => {
            if (leaveTimerRef.current) {
              window.clearTimeout(leaveTimerRef.current);
              leaveTimerRef.current = null;
            }
          }}
          onPointerLeave={handleLeave}
        >
          <div className="flex items-center gap-3 border-b p-4">
            <LinkGlyph item={item} size={44} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-[16px] text-ds-text leading-tight">
                {item.name}
              </p>
              {item.role ? (
                <p className="truncate text-[14px] text-ds-text-tertiary">{item.role}</p>
              ) : null}
            </div>
          </div>

          {fields.length > 0 ? (
            <div className="space-y-[9px] px-4 py-3 text-[14px] text-ds-text-muted">
              {fields.map((f, i) => {
                const Icon = FIELD_ICON[f.key] ?? Briefcase;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable order, no list mutation
                    key={i}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <Icon weight="regular" size={16} className="shrink-0 text-ds-text-tertiary" />
                    <span className="truncate">{f.value}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <a
            href={href}
            className="flex items-center justify-center gap-1 border-t px-4 py-3 font-medium text-[14px] text-primary-700 hover:bg-ds-hover"
          >
            Ouvrir la fiche
            <ArrowRight weight="bold" size={12} />
          </a>
        </div>
      ) : null}
    </span>
  );
}
