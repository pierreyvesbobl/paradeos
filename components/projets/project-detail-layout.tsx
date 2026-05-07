"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "project-detail:sidebar";

type Props = {
  main: React.ReactNode;
  sidebar: React.ReactNode;
};

/**
 * Layout split pour la fiche projet : main (Tâches + Notes) à gauche,
 * sidebar repliable à droite (Détails / Entité / Temps / Rentabilité).
 *
 * - Sur mobile : stack vertical, main puis sidebar.
 * - Sur lg+ : 2 colonnes, sidebar sticky, collapse persisté en localStorage.
 */
export function ProjectDetailLayout({ main, sidebar }: Props) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "closed") setOpen(false);
    } catch {}
  }, []);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
      } catch {}
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <main className="min-w-0 flex-1 space-y-8">{main}</main>
      <aside
        className={cn(
          "shrink-0 transition-[width] duration-200",
          open ? "lg:w-80 xl:w-96" : "lg:w-10",
        )}
      >
        <div className="lg:sticky lg:top-6">
          <div className="hidden items-center justify-between border-b pb-2 lg:flex">
            <p
              className={cn(
                "font-medium text-[11px] text-muted-foreground uppercase tracking-wider",
                !open && "sr-only",
              )}
            >
              Détails
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggle}
              className="size-7"
              aria-label={open ? "Replier les détails" : "Déplier les détails"}
            >
              {open ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          </div>
          <div className={cn("mt-4 space-y-6", !open && "lg:hidden")}>{sidebar}</div>
        </div>
      </aside>
    </div>
  );
}
