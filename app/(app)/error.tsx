"use client";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Error boundary de la zone authentifiée. Capture les exceptions levées
 * par les Server Components et les pages du segment (app) sans casser le
 * layout (sidebar + topbar restent affichés).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 py-12">
      <EmptyState
        icon={WarningCircle}
        title="Cette page n'a pas pu être chargée."
        description={
          error.digest
            ? `Une erreur est survenue côté serveur (référence ${error.digest}).`
            : "Une erreur est survenue. Réessaie, ou reviens à l'accueil."
        }
        action={
          <div className="flex gap-2">
            <Button onClick={reset}>Réessayer</Button>
            <Button variant="outline" asChild>
              <Link href="/">Retour à l'accueil</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
