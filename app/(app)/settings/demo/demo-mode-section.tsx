"use client";

import { Button } from "@/components/ui/button";
import { toggleDemoMode } from "@/lib/actions/demo-mode";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export function DemoModeSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const next = !enabled;
      const res = await toggleDemoMode({ enabled: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(next ? "Mode démo activé." : "Mode démo désactivé.");
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Mode démo</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Anonymise visuellement noms d'entreprises, contacts, projets et montants. Les données en
            base ne sont pas modifiées. Les exports (PDF, CSV, Dougs) restent réels. Bascule globale
            — affecte tous les utilisateurs.
          </p>
        </div>
        <span
          className={
            enabled
              ? "rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-orange-800 text-xs dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200"
              : "rounded-full border bg-muted px-2 py-0.5 text-muted-foreground text-xs"
          }
        >
          {enabled ? "Activé" : "Désactivé"}
        </span>
      </header>
      <Button
        size="sm"
        variant={enabled ? "outline" : "default"}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "…" : enabled ? "Désactiver le mode démo" : "Activer le mode démo"}
      </Button>
    </section>
  );
}
