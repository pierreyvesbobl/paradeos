"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

/** Bloc de commande ou de config à copier, commun aux guides d'installation. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible.");
    }
  }

  return (
    <div className="rounded border bg-muted/40">
      <div className="flex items-center justify-between border-b px-2 py-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-background"
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
      <pre className="overflow-x-auto whitespace-pre-wrap p-2 font-mono text-[11px] leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
