"use client";

import { Button } from "@/components/ui/button";
import { revokeMcpGrant } from "@/lib/actions/mcp-setup";
import { formatDate } from "@/lib/format";
import { Plug, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export type Connection = {
  clientId: string;
  clientName: string;
  scope: string;
  lastUsedAt: string | null;
  createdAt: string;
};

/**
 * Connecteurs OAuth actifs. Sans cette liste, un accès accordé depuis
 * claude.ai n'est révocable nulle part côté Paradeos — un token qu'on ne
 * peut pas retirer n'est pas un token acceptable.
 */
export function McpConnections({ connections }: { connections: Connection[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function revoke(clientId: string, name: string) {
    if (!window.confirm(`Déconnecter « ${name} » ? Le client devra redemander l'accès.`)) return;
    startTransition(async () => {
      const res = await revokeMcpGrant(clientId);
      if (!res.ok) {
        toast.error(res.message ?? "Révocation impossible.");
        return;
      }
      toast.success("Connecteur déconnecté.");
      router.refresh();
    });
  }

  if (connections.length === 0) {
    return (
      <p className="text-muted-foreground text-xs italic">
        Aucun connecteur OAuth actif. Ajoute Paradeos depuis ton client MCP pour en créer un.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border bg-background">
      {connections.map((c) => (
        <li key={c.clientId} className="flex items-center gap-2 px-3 py-2">
          <Plug className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{c.clientName}</p>
            <p className="text-[11px] text-muted-foreground">
              {c.scope.includes("mcp:write") ? "Lecture + écriture" : "Lecture seule"} · Autorisé le{" "}
              {formatDate(c.createdAt)}
              {c.lastUsedAt ? ` · Utilisé le ${formatDate(c.lastUsedAt)}` : " · Jamais utilisé"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => revoke(c.clientId, c.clientName)}
            className="text-muted-foreground hover:text-destructive"
            title="Déconnecter"
            aria-label={`Déconnecter ${c.clientName}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
