"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const APP_URL =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "https://paradeos.app";

const HTTP_PROMPT = (
  url: string,
) => `Configure le serveur MCP "paradeos" sur ce poste (Claude Desktop / Cursor / autre).

Mode : HTTP.
URL : ${url}/api/mcp
Token (à coller depuis Réglages → Intégrations → Mes accès MCP) : paradeos_pat_…

Détecte le client MCP installé, ajoute l'entrée dans la bonne config (ex.
~/Library/Application Support/Claude/claude_desktop_config.json sur macOS) et
demande-moi de redémarrer le client à la fin.`;

const STDIO_PROMPT = (
  userId: string,
) => `Configure le serveur MCP "paradeos" en mode stdio sur ce poste.

Pré-requis : le repo Paradeos est cloné localement. Vérifie qu'il y a un dossier
"mcp-server" et un node_modules/.bin/tsx. Si l'install n'a pas été faite, lance
"pnpm install" dans le repo.

Variables à poser :
- DATABASE_URL : récupère-la depuis le fichier .env.local du repo
- PARADEOS_USER_ID : ${userId}

Ajoute l'entrée dans la config Claude Desktop (ou autre client MCP installé) avec
les chemins ABSOLUS (utilise pwd et le repo path), puis demande-moi de redémarrer
le client à la fin.`;

/**
 * Guide « demande à Claude de t'installer le MCP » — au lieu de longues
 * instructions à suivre manuellement, on fournit un prompt prêt à coller
 * dans Claude Code (CLI agent qui a accès au filesystem). Claude détecte
 * la plateforme, trouve le bon fichier de config, l'édite proprement.
 */
export function McpSetupGuide({ userId }: { userId: string }) {
  return (
    <div className="mt-6 space-y-4 border-t pt-5">
      <div>
        <h3 className="font-medium text-foreground text-sm">
          Configurer ton client MCP en 1 prompt
        </h3>
        <p className="mt-1 text-muted-foreground text-xs">
          Le plus simple : ouvre <strong>Claude Code</strong> dans n'importe quel dossier (ou un
          autre agent CLI capable d'éditer ta config) et colle un des prompts ci-dessous. Il
          détectera ton client MCP, trouvera le bon fichier de config et fera l'édition pour toi.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Option A — HTTP (recommandé)" subtitle="Pas d'install locale, juste un token.">
          <ol className="space-y-2 text-xs">
            <Step n={1}>
              Génère un token plus haut. <strong>Copie-le immédiatement</strong>.
            </Step>
            <Step n={2}>
              Lance <code>claude</code> dans un terminal (ou ton agent préféré).
            </Step>
            <Step n={3}>
              Colle ce prompt en remplaçant <code>paradeos_pat_…</code> par ton token :
            </Step>
            <li className="ml-7">
              <CodeBlock code={HTTP_PROMPT(APP_URL)} label="Prompt à coller" />
            </li>
            <Step n={4}>Laisse Claude éditer la config, puis redémarre ton client MCP.</Step>
          </ol>
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Si ton client MCP ne supporte pas le HTTP nativement, Claude installera un bridge{" "}
            <a
              href="https://github.com/geelen/mcp-remote"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              mcp-remote
            </a>
            .
          </p>
        </Card>

        <Card title="Option B — Stdio (CLI local)" subtitle="Connexion directe à la DB.">
          <ol className="space-y-2 text-xs">
            <Step n={1}>
              Lance <code>claude</code> dans le dossier du repo Paradeos cloné.
            </Step>
            <Step n={2}>Colle ce prompt — ton UUID est déjà inclus, prêt à l'emploi :</Step>
            <li className="ml-7">
              <CodeBlock code={STDIO_PROMPT(userId)} label="Prompt à coller (UUID inclus)" />
            </li>
            <Step n={3}>
              Claude lit ton <code>.env.local</code> (<code>DATABASE_URL</code>) et configure la
              config Claude Desktop avec les chemins absolus.
            </Step>
            <Step n={4}>Redémarre Claude Desktop.</Step>
          </ol>
        </Card>
      </div>

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">
          Tu préfères éditer la config à la main ?
        </summary>
        <p className="mt-2">
          C'est aussi rapide pour qui connaît son chemin de config. Schéma minimum à coller dans{" "}
          <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) :
        </p>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <CodeBlock
            code={`{
  "mcpServers": {
    "paradeos": {
      "url": "${APP_URL}/api/mcp",
      "headers": {
        "Authorization": "Bearer paradeos_pat_…"
      }
    }
  }
}`}
            label="HTTP"
          />
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
            label="Stdio (UUID inclus)"
          />
        </div>
      </details>

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">
          Tools disponibles côté Claude
        </summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <li>
            <strong>Reads</strong> : list_projects, get_project, list_tasks, list_my_tasks,
            list_meetings, get_meeting, list_my_time, list_contacts, list_entities
          </li>
          <li>
            <strong>Writes</strong> : create_task, complete_task, log_time, add_note
          </li>
          <li>
            <strong>Search</strong> : search_all (full-text sur projets, tâches, contacts, entités,
            meetings)
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

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">Exemples de prompts</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>« Liste mes tâches en retard avec le projet associé »</li>
          <li>« Crée une tâche 'Préparer le devis' pour le projet Acme, échéance vendredi »</li>
          <li>« Combien d'heures j'ai passé sur Refonte Site cette semaine ? »</li>
          <li>
            « Synthèse markdown du projet Prev&care » (utilise <code>/project_summary</code>)
          </li>
          <li>
            « Aide-moi à planifier ma semaine » (utilise <code>/plan_my_week</code>)
          </li>
          <li>« Marque la tâche X comme terminée »</li>
          <li>« Note sur le contact Y : 'Préfère être contacté le matin' »</li>
        </ul>
      </details>
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
      <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}
