import { claudeModState, isPluginGrant } from "@/lib/claude-mod/install";
import { getClaudeModSignal } from "@/lib/db/queries/claude-activity";
import { listUserGrants } from "@/lib/oauth/store";
import { ClaudeModInstall } from "./claude-mod-install";

/**
 * Installation du mod Claude Code « paradeos-temps » pour l'utilisateur
 * connecté. L'état vient de ce que la machine a déjà envoyé (segments
 * d'activité) et du grant OAuth que Claude Code crée pour le serveur MCP du
 * plugin : la page sait donc dire « rien d'installé », « autorisé, en
 * attente du premier signal » ou « actif » sans rien demander.
 */
export async function ClaudeModSection({ userId }: { userId: string }) {
  const [signal, grants] = await Promise.all([getClaudeModSignal(userId), listUserGrants(userId)]);
  const authorized = grants.some((g) => isPluginGrant(g.clientName));
  const state = claudeModState({ lastSegmentAt: signal.lastSegmentAt, authorized });

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="font-medium text-sm">Claude Code · suivi du temps et contexte projet</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Le mod <code>paradeos-temps</code> compte le temps d'attention passé dans chaque session
          Claude Code et l'envoie ici comme signal, rattaché au projet du dépôt git. Il donne aussi
          à la session le contexte du projet (tâches ouvertes, feuille de route) et remonte les
          commits. Ce n'est pas du temps réalisé : tu l'imputes toi-même dans la grille de /temps.
        </p>
      </header>
      <ClaudeModInstall
        state={state}
        authorized={authorized}
        lastSegmentAt={signal.lastSegmentAt?.toISOString() ?? null}
        segments7d={signal.segments7d}
        remotes7d={signal.remotes7d}
      />
    </section>
  );
}
