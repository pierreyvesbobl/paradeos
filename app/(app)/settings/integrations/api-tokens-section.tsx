import { getTokensForUser } from "@/lib/db/queries/api-tokens";
import { ApiTokensForm } from "./api-tokens-form";
import { McpSetupGuide } from "./mcp-setup-guide";

export async function ApiTokensSection({ userId }: { userId: string }) {
  const tokens = await getTokensForUser(userId);
  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="font-medium text-sm">Mes accès MCP</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Permet à Claude (Desktop, web, Cursor…) d'interroger Paradeos en langage naturel : « mes
          tâches en retard », « crée une tâche pour le projet Acme », « combien d'heures cette
          semaine ? ». Génère un token ici puis configure ton client MCP.
        </p>
      </header>
      <ApiTokensForm
        tokens={tokens.map((t) => ({
          id: t.id,
          label: t.label,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
        }))}
      />
      <McpSetupGuide userId={userId} />
    </section>
  );
}
