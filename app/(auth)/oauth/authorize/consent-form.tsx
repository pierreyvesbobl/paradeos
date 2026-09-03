"use client";

import { Button } from "@/components/ui/button";
import { approveAuthorization, denyAuthorization } from "@/lib/actions/oauth";
import { useState, useTransition } from "react";

/**
 * Boutons Autoriser / Refuser. Les deux actions redirigent vers le client
 * MCP en cas de succès ; elles ne renvoient une chaîne que sur erreur,
 * qu'on affiche en place plutôt que dans un toast (la page est sur le
 * point de disparaître, un toast serait perdu).
 */
export function ConsentForm({ params, clientName }: { params: string; clientName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (fd: FormData) => Promise<string | undefined>) {
    const fd = new FormData();
    fd.set("params", params);
    setError(null);
    startTransition(async () => {
      const message = await action(fd);
      if (message) setError(message);
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          onClick={() => run(approveAuthorization)}
        >
          {pending ? "…" : `Autoriser ${clientName}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => run(denyAuthorization)}
        >
          Refuser
        </Button>
      </div>
    </div>
  );
}
