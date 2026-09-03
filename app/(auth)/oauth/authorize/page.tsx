import { getAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/server";
import { parseAuthorizeParams } from "@/lib/oauth/authorize-params";
import { SCOPE_LABELS, type Scope, isAcceptableResource } from "@/lib/oauth/config";
import { getClient } from "@/lib/oauth/store";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

/**
 * Écran de consentement OAuth. Le middleware ayant déjà exigé une session
 * Supabase, arriver ici signifie que l'utilisateur est un membre de
 * l'équipe : il ne reste qu'à lui montrer *qui* demande *quoi*.
 *
 * Les erreurs de paramètres sont affichées ici plutôt que renvoyées au
 * client : tant que le `redirect_uri` n'est pas validé contre la liste
 * enregistrée, rediriger dessus serait une redirection ouverte.
 */
export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }

  const parsed = parseAuthorizeParams(query);
  if (!parsed.ok) return <AuthorizeError title="Requête invalide" detail={parsed.description} />;
  const params = parsed.params;

  const client = await getClient(params.clientId);
  if (!client) {
    return (
      <AuthorizeError
        title="Client inconnu"
        detail="Ce client n'est pas enregistré. Relance la connexion depuis ton client MCP."
      />
    );
  }
  if (!client.redirectUris.includes(params.redirectUri)) {
    return (
      <AuthorizeError
        title="Redirection non autorisée"
        detail="Le `redirect_uri` fourni ne fait pas partie de ceux enregistrés par ce client."
      />
    );
  }

  const appUrl = await getAppUrl();
  if (params.resource && !isAcceptableResource(params.resource, appUrl)) {
    return (
      <AuthorizeError
        title="Ressource inconnue"
        detail="Le client demande un accès pour un serveur qui n'est pas celui-ci."
      />
    );
  }

  const scopes = params.scope.split(" ").filter(Boolean) as Scope[];

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          <p className="font-medium font-mono text-muted-foreground text-sm tracking-tight">
            Parade OS
          </p>
          <h1 className="font-semibold text-xl tracking-tight">Autoriser {client.clientName} ?</h1>
          <p className="text-muted-foreground text-sm">
            Ce client demande à accéder à Paradeos en ton nom, en tant que{" "}
            <strong className="text-foreground">{user.email}</strong>.
          </p>
        </div>

        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <p className="font-medium text-xs uppercase tracking-wider">Accès demandés</p>
          <ul className="space-y-2">
            {scopes.map((scope) => (
              <li key={scope} className="flex gap-2 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                <span>{SCOPE_LABELS[scope]}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Tu pourras révoquer cet accès à tout moment depuis Réglages → Intégrations. L'accès expire
          automatiquement après 30 jours d'inactivité.
        </p>

        <ConsentForm params={query.toString()} clientName={client.clientName} />
      </div>
    </main>
  );
}

function AuthorizeError({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="font-semibold text-lg tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{detail}</p>
      </div>
    </main>
  );
}
