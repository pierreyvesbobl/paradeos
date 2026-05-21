"use client";

import { Button } from "@/components/ui/button";
import { setGmailExtractionEnabled } from "@/lib/actions/gmail";
import { Power } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export function GmailExtractionToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await setGmailExtractionEnabled({ enabled: !enabled });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(enabled ? "Extraction LLM désactivée." : "Extraction LLM activée.");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={enabled ? "default" : "outline"}
      onClick={toggle}
      disabled={pending}
      className="shrink-0 gap-1.5"
      title={enabled ? "Cliquer pour désactiver" : "Cliquer pour activer"}
    >
      <Power className="size-3.5" />
      {enabled ? "Activée" : "Désactivée"}
    </Button>
  );
}
