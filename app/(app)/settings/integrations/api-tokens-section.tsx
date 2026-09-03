import { getTokensForUser } from "@/lib/db/queries/api-tokens";
import { listUserGrants } from "@/lib/oauth/store";
import { ApiTokensForm } from "./api-tokens-form";
import { McpConnections } from "./mcp-connections";
import { McpSetupGuide } from "./mcp-setup-guide";

/**
 * Les dates des grants viennent d'agrégats SQL bruts (`min`/`max`) : le
 * driver peut rendre une Date ou une chaîne selon le chemin de parsing,
 * on normalise plutôt que de présumer.
 */
function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function ApiTokensSection({ userId }: { userId: string }) {
  const [tokens, grants] = await Promise.all([getTokensForUser(userId), listUserGrants(userId)]);

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="font-medium text-sm">Mes accès MCP</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Permet à Claude (Desktop, web, Cursor…) d'interroger Paradeos en langage naturel : « mes
          tâches en retard », « crée une tâche pour le projet Acme », « combien d'heures cette
          semaine ? ». Le plus simple est de coller l'URL du serveur dans ton client — voir plus
          bas.
        </p>
      </header>

      <div className="space-y-2">
        <h3 className="font-medium text-xs uppercase tracking-wider">Connecteurs autorisés</h3>
        <McpConnections
          connections={grants.map((g) => ({
            clientId: g.clientId,
            clientName: g.clientName ?? "Client MCP",
            scope: g.scope,
            createdAt: toIso(g.createdAt) ?? "",
            lastUsedAt: toIso(g.lastUsedAt),
          }))}
        />
      </div>

      <div className="mt-6 space-y-2 border-t pt-5">
        <h3 className="font-medium text-xs uppercase tracking-wider">
          Tokens personnels (clients sans OAuth)
        </h3>
        <ApiTokensForm
          tokens={tokens.map((t) => ({
            id: t.id,
            label: t.label,
            createdAt: t.createdAt.toISOString(),
            lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
            revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
          }))}
        />
      </div>

      <McpSetupGuide userId={userId} />
    </section>
  );
}
