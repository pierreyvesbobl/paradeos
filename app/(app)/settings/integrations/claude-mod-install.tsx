"use client";

import {
  ArrowClockwise,
  CheckCircle,
  CircleDashed,
  Clock,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  type ClaudeModState,
  installCommand,
  installCommandsLegacy,
  MIN_CLAUDE_CODE_VERSION,
  PLUGIN_MCP_SERVER,
  PLUGIN_VERSION,
  STALE_AFTER_DAYS,
  uninstallCommand,
  updateCommand,
} from "@/lib/claude-mod/install";
import { formatRelativeShort } from "@/lib/format";
import { CodeBlock } from "./code-block";

type Props = {
  state: ClaudeModState;
  authorized: boolean;
  lastSegmentAt: string | null;
  segments7d: number;
  remotes7d: string[];
};

/** Tant que le premier signal n'est pas là, on recharge l'état à ce rythme :
 * l'utilisateur installe dans son terminal et revient voir si c'est bon. */
const POLL_MS = 15_000;

export function ClaudeModInstall(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => new Date());

  function refresh() {
    startTransition(() => {
      setNow(new Date());
      router.refresh();
    });
  }

  useEffect(() => {
    if (props.state === "active") return;
    const id = setInterval(() => {
      setNow(new Date());
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [props.state, router]);

  return (
    <div className="space-y-5">
      <StatusCard {...props} now={now} pending={pending} onRefresh={refresh} />

      <div>
        <h3 className="font-medium text-xs uppercase tracking-wider">Installer</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          Trois gestes sur chaque machine où tu utilises Claude Code. L'identité vient de
          l'autorisation : chacun écrit ses propres segments.
        </p>
        <ol className="mt-3 space-y-3 text-xs">
          <Step n={1} title="Installer le mod">
            <p className="mb-2 text-muted-foreground">
              Dans un terminal, Claude Code fermé ou ouvert. La commande ajoute le dépôt Parade OS
              comme marketplace si besoin, puis installe le mod pour toutes tes sessions.
            </p>
            <CodeBlock code={installCommand()} label="Terminal" />
          </Step>
          <Step n={2} title="Autoriser le serveur Parade OS">
            <p className="text-muted-foreground">
              Ouvre une session Claude Code, tape <code>/mcp</code>, choisis{" "}
              <code>{PLUGIN_MCP_SERVER}</code> et clique <strong>Autoriser</strong> sur la page
              Parade OS qui s'ouvre. Une fois par machine.
            </p>
          </Step>
          <Step n={3} title="Travailler">
            <p className="text-muted-foreground">
              Rien d'autre à faire : au premier tour, cette page passe en « actif ». Les dépôts
              inconnus apparaissent dans{" "}
              <Link href="/temps" className="underline underline-offset-2">
                /temps
              </Link>{" "}
              avec un sélecteur de projet, ou se rattachent depuis la fiche projet, section « Dépôts
              git ».
            </p>
          </Step>
        </ol>
      </div>

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer hover:text-foreground">
          Mettre à jour, désinstaller, anciennes versions
        </summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <CodeBlock
              code={updateCommand()}
              label={`Mettre à jour (publié : ${PLUGIN_VERSION})`}
            />
            <p className="mt-1 text-[11px]">
              Puis redémarre Claude Code ou <code>/reload-plugins</code>.
            </p>
          </div>
          <CodeBlock code={uninstallCommand()} label="Désinstaller" />
          <div className="lg:col-span-2">
            <CodeBlock
              code={installCommandsLegacy()}
              label={`Claude Code antérieur à ${MIN_CLAUDE_CODE_VERSION}`}
            />
          </div>
        </div>
        <p className="mt-3 text-[11px]">
          Développeurs : si tu charges déjà le mod depuis ton clone (
          <code>CLAUDE_CODE_PLUGIN_DIRS</code> ou <code>--plugin-dir</code>), n'installe pas aussi
          la version publiée, les deux tourneraient en même temps.
        </p>
      </details>

      <p className="text-[11px] text-muted-foreground">
        Ne quittent ta machine que des horodatages, le remote git (ou le nom du dossier sans git)
        et, sur un dépôt rattaché à un projet, les derniers commits. Jamais le contenu des échanges
        ni les fichiers. Règles de comptage dans <code>claude-mod/README.md</code>.
      </p>
    </div>
  );
}

function StatusCard({
  state,
  authorized,
  lastSegmentAt,
  segments7d,
  remotes7d,
  now,
  pending,
  onRefresh,
}: Props & { now: Date; pending: boolean; onRefresh: () => void }) {
  const last = lastSegmentAt ? formatRelativeShort(lastSegmentAt, now) : null;

  const content = {
    not_installed: {
      icon: <CircleDashed className="size-4 text-muted-foreground" />,
      title: "Pas encore installé sur tes machines",
      detail:
        "Aucune autorisation ni signal reçu pour ton compte. Suis les trois étapes ci-dessous.",
      tint: "border-border bg-muted/20",
    },
    awaiting_signal: {
      icon: <Clock className="size-4 text-amber-600" />,
      title: "Autorisé, en attente du premier signal",
      detail:
        "Le serveur Parade OS est autorisé dans Claude Code. Le premier segment arrive quelques minutes après ton premier échange dans une session.",
      tint: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
    },
    active: {
      icon: <CheckCircle className="size-4 text-emerald-600" weight="fill" />,
      title: `Actif · dernier signal ${last}`,
      detail: `${segments7d} segment${segments7d > 1 ? "s" : ""} reçu${segments7d > 1 ? "s" : ""} ces sept derniers jours${
        authorized
          ? ""
          : ", sans autorisation OAuth visible (mod chargé depuis un clone ou token personnel)"
      }.`,
      tint: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
    },
    stale: {
      icon: <WarningCircle className="size-4 text-amber-600" />,
      title: `Silencieux · dernier signal ${last}`,
      detail: `Plus rien depuis ${STALE_AFTER_DAYS} jours. Le mod a sans doute été désinstallé, ou Claude Code n'a pas tourné sur cette machine. Réinstalle si besoin.`,
      tint: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
    },
  }[state];

  return (
    <div className={`rounded-md border p-4 ${content.tint}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">{content.icon}</span>
          <div>
            <p className="font-medium text-sm">{content.title}</p>
            <p className="mt-0.5 text-muted-foreground text-xs">{content.detail}</p>
            {state === "active" && remotes7d.length > 0 ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Dépôts vus : {remotes7d.join(", ")}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
          title="Actualiser l'état"
        >
          <ArrowClockwise className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground font-medium text-[10px] text-background">
        {n}
      </span>
      <div className="min-w-0 flex-1 leading-relaxed">
        <p className="mb-1 font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}
