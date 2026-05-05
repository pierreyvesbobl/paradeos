"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Placeholder Cmd+K. Le vrai dialog (recherche globale, navigation) sera
 * câblé en phase 2 quand on aura quelque chose à indexer.
 */
export function CommandPalette() {
  const [, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-muted/40 px-3 text-muted-foreground text-sm transition-colors hover:bg-muted"
    >
      <Search className="size-4" />
      <span>Rechercher…</span>
      <kbd className="ml-auto rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">
        ⌘K
      </kbd>
    </button>
  );
}
