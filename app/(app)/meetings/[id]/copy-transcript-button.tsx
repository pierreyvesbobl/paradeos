"use client";

import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CopyTranscriptButton({ transcript }: { transcript: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy(e: React.MouseEvent<HTMLButtonElement>) {
    // Empêche le <details> parent de se toggler quand on clique le bouton
    // depuis l'intérieur du <summary>.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible — sélectionne et copie à la main.");
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onCopy}
      className="h-7 gap-1 px-2 text-xs"
      aria-label="Copier le transcript"
    >
      {copied ? (
        <>
          <Check className="size-3.5" />
          Copié
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          Copier
        </>
      )}
    </Button>
  );
}
