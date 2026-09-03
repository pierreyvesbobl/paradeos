"use client";

import { Button } from "@/components/ui/button";
import { type DiagnosticStep, checkMcpSetup } from "@/lib/actions/mcp-setup";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const FALLBACK_URL = "https://paradeos.vercel.app";

function appUrl() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return FALLBACK_URL;
}

/** Config `mcp.json` d'un client, encodée pour le deeplink Cursor. */
function cursorDeeplink(url: string) {
  const config = { url: `${url}/api/mcp` };
  const encoded =
    typeof window === "undefined"
      ? ""
      : window.btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(config))));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=paradeos&config=${encodeURIComponent(encoded)}`;
}

/**
 * Guide d'installation du MCP. Depuis le passage à OAuth, le chemin
 * nominal ne demande plus de token du tout : le client découvre seul
 * comment s'authentifier à partir de la seule URL, et l'utilisateur
 * approuve sur l'écran de consentement. Le token personnel reste
 * disponible pour les clients qui ne savent pas faire OAuth.
 */
export function McpSetupGuide({ userId }: { userId: string }) {
  const url = appUrl();
  const mcpUrl = `${url}/api/mcp`;

  return (
    <div className="mt-6 space-y-4 border-t pt-5">
      <div>
        <h3 className="font-medium text-foreground text-sm">Connecter ton client MCP</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          Colle l'URL ci-dessous dans ton client : il négocie l'authentification tout seul et
          t'amène sur un écran d'autorisation Paradeos. Aucun token à copier, aucune config à
          éditer.
        </p>
      </div>

      <CodeBlock code={mcpUrl} label="URL du serveur MCP" />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="Claude.ai · Claude Desktop"
          subtitle="Connecteur personnalisé, en collant l'URL."
        >
          <ol className="space-y-2 text-xs">
            <Step n={1}>
              Réglages → <strong>Connecteurs</strong> → « Ajouter un connecteur personnalisé ».
            </Step>
            <Step n={2}>Colle l'URL ci-dessus. Laisse les réglages avancés vides.</Step>
            <Step n={3}>
              Une page Paradeos s'ouvre : clique <strong>Autoriser</strong>.
            </Step>
          </ol>
        </Card>

        <Card title="Claude Code · Cursor · VS Code" subtitle="Une commande, puis autorisation.">
          <CodeBlock
            code={`claude mcp add --transport http paradeos ${mcpUrl}`}
            label="Claude Code"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Puis <code>/mcp</code> dans Claude Code pour lancer l'autorisation.
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <a href={cursorDeeplink(url)}>
                <ExternalLink className="size-3.5" />
                Installer dans Cursor
              </a>
            </Button>
          </div>
        </Card>
      </div>

      <SetupCheck />

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">
          Mon client ne sait pas faire OAuth
        </summary>
        <p className="mt-2">
          Génère un token plus haut, puis passe-le en en-tête. C'est le mode historique — il reste
          supporté, mais le token vit en clair dans un fichier de config, contrairement au flow
          OAuth.
        </p>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <CodeBlock
            code={`claude mcp add --transport http paradeos ${mcpUrl} \\
  --header "Authorization: Bearer paradeos_pat_…"`}
            label="Claude Code + token"
          />
          <CodeBlock
            code={`{
  "mcpServers": {
    "paradeos": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer paradeos_pat_…"
      }
    }
  }
}`}
            label="Config JSON manuelle"
          />
        </div>
      </details>

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">
          Mode stdio (connexion directe à la base)
        </summary>
        <p className="mt-2">
          Réservé au dev sur le repo cloné. Nécessite <code>DATABASE_URL</code> et ton UUID (
          <code className="break-all">{userId}</code>).
        </p>
        <div className="mt-2">
          <CodeBlock
            code={`{
  "mcpServers": {
    "paradeos": {
      "command": "/CHEMIN/paradeos/node_modules/.bin/tsx",
      "args": ["/CHEMIN/paradeos/mcp-server/index.ts"],
      "env": {
        "DATABASE_URL": "postgres://…",
        "PARADEOS_USER_ID": "${userId}"
      }
    }
  }
}`}
            label="Stdio"
          />
        </div>
      </details>

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">
          Tools disponibles côté Claude
        </summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <li>
            <strong>Lecture</strong> : list_projects, get_project, list_tasks, list_my_tasks,
            list_meetings, get_meeting, get_meeting_transcript, list_my_time, list_contacts,
            list_entities, list_notes, get_note, list_emails, get_email_thread, search_all
          </li>
          <li>
            <strong>Écriture</strong> (scope <code>mcp:write</code>) : create_task, complete_task,
            create_project, update_project, update_contact, update_entity, log_time, add_note,
            push_project_quote, push_project_milestone_invoice, push_coworking_invoice
          </li>
          <li>
            <strong>Resources</strong> : <code>paradeos://projects</code>,{" "}
            <code>paradeos://projects/&#123;id&#125;</code>,{" "}
            <code>paradeos://meetings/&#123;id&#125;</code>, <code>paradeos://tasks/today</code>,{" "}
            <code>paradeos://tasks/overdue</code>
          </li>
          <li>
            <strong>Prompts</strong> : <code>/plan_my_week</code>, <code>/project_summary</code>,{" "}
            <code>/commercial_brief</code>
          </li>
        </ul>
      </details>
    </div>
  );
}

/**
 * Diagnostic en un clic. Sonde depuis le serveur les trois points qui
 * cassent une installation (découverte × 2 + défi 401), pour distinguer
 * « mon client est mal configuré » de « le serveur ne publie pas ce qu'il
 * faut ».
 */
function SetupCheck() {
  const [pending, startTransition] = useTransition();
  const [steps, setSteps] = useState<DiagnosticStep[] | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const res = await checkMcpSetup();
        setSteps(res.steps);
      } catch {
        toast.error("Vérification impossible.");
      }
    });
  }

  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="font-medium text-sm">Vérifier la configuration</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Teste que la découverte OAuth est bien servie depuis cette adresse.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Tester"}
        </Button>
      </div>
      {steps ? (
        <ul className="mt-3 space-y-1.5">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2 text-xs">
              {s.ok ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              )}
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground"> — {s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <h4 className="font-medium text-sm">{title}</h4>
      {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground font-medium text-[10px] text-background">
        {n}
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </li>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
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
