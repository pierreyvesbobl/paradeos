"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Affiche l'UUID Supabase de l'user courant avec un bouton Copier.
 * Utilisé pour configurer le serveur MCP (mode stdio) — l'user pose
 * cet UUID dans `PARADEOS_USER_ID` côté Claude Desktop.
 */
export function UserIdDisplay({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible — sélectionne et copie à la main.");
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        UUID (pour le serveur MCP)
      </p>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
        <code className="flex-1 truncate font-mono text-sm">{userId}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground text-xs hover:bg-background hover:text-foreground"
          aria-label="Copier l'UUID"
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copié
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copier
            </>
          )}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        À coller dans <code>PARADEOS_USER_ID</code> de la config Claude Desktop (mode stdio MCP).
        Pas un secret en soi, mais évite de le poster sur des canaux publics.
      </p>
    </div>
  );
}
