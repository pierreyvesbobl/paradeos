import manifest from "../../claude-mod/.claude-plugin/plugin.json";

/**
 * Distribution du mod Claude Code `claude-mod/` (paradeos-temps).
 *
 * Le dépôt Parade OS est public et porte un `.claude-plugin/marketplace.json`
 * à sa racine : Claude Code sait donc l'ajouter comme marketplace et en
 * installer le mod en une commande, sans cloner quoi que ce soit à la main.
 * Ce module ne fait que produire les commandes et lire l'état : tout ce qui
 * est affiché dans Réglages → Intégrations → Claude Code vient d'ici, pour
 * que la page et le README racontent la même chose.
 */

/** `owner/repo` GitHub qui héberge le marketplace (dépôt public). */
export const MARKETPLACE_REPO = "pierreyvesbobl/paradeos";
/** `name` du marketplace.json à la racine du dépôt. */
export const MARKETPLACE_NAME = "paradeos";
/** `name` du plugin.json du mod. */
export const PLUGIN_NAME = manifest.name;
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
/** Version publiée (celle du dépôt au moment du build). */
export const PLUGIN_VERSION = manifest.version;
/** Nom du serveur MCP embarqué par le mod (cf. claude-mod/.mcp.json). */
export const PLUGIN_MCP_SERVER = "paradeos";
/** Version de Claude Code à partir de laquelle `--marketplace` existe. */
export const MIN_CLAUDE_CODE_VERSION = "2.1.292";

/** Une seule commande : ajoute le marketplace si besoin, puis installe. */
export function installCommand(): string {
  return `claude plugin install ${PLUGIN_NAME} --marketplace ${MARKETPLACE_REPO}`;
}

export function updateCommand(): string {
  return `claude plugin update ${PLUGIN_ID}`;
}

export function uninstallCommand(): string {
  return `claude plugin uninstall ${PLUGIN_ID}`;
}

/** Chemin de secours, pour un Claude Code trop ancien pour `--marketplace`. */
export function installCommandsLegacy(): string {
  return [
    `claude plugin marketplace add ${MARKETPLACE_REPO}`,
    `claude plugin install ${PLUGIN_ID}`,
  ].join("\n");
}

/** Signature du client OAuth que Claude Code enregistre pour le serveur
 * MCP d'un plugin : `Claude Code (plugin:<plugin>:<marketplace>)`. */
export function isPluginGrant(clientName: string | null | undefined): boolean {
  return !!clientName && clientName.includes(`plugin:${PLUGIN_NAME}`);
}

/** Au-delà, le dernier signal est considéré ancien : le mod a sans doute
 * été désinstallé, ou la machine n'a pas ouvert Claude Code depuis. */
export const STALE_AFTER_DAYS = 7;

export type ClaudeModState =
  /** Ni autorisation OAuth, ni signal : rien n'est installé. */
  | "not_installed"
  /** Le serveur MCP du mod est autorisé mais aucun segment n'est arrivé. */
  | "awaiting_signal"
  /** Un segment est arrivé récemment. */
  | "active"
  /** Des segments existent, mais aucun depuis STALE_AFTER_DAYS. */
  | "stale";

export function claudeModState(input: {
  lastSegmentAt: Date | null;
  authorized: boolean;
  now?: Date;
}): ClaudeModState {
  const now = input.now ?? new Date();
  if (input.lastSegmentAt) {
    const ageMs = now.getTime() - input.lastSegmentAt.getTime();
    return ageMs <= STALE_AFTER_DAYS * 86_400_000 ? "active" : "stale";
  }
  return input.authorized ? "awaiting_signal" : "not_installed";
}
