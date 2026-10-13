/**
 * Normalise l'URL d'un remote git en une clé stable et comparable :
 * `github.com/parade/paradeos`. Même dépôt cloné en SSH ou en HTTPS, avec
 * ou sans `.git`, avec ou sans user, sur deux machines : même clé.
 *
 * Formes reconnues :
 *  - git@github.com:owner/repo.git
 *  - ssh://git@github.com/owner/repo.git
 *  - https://user@github.com/owner/repo.git/
 *  - github.com/owner/repo (déjà normalisée)
 *
 * Retourne null quand rien d'exploitable n'en sort (chaîne vide, chemin
 * local, protocole exotique sans hôte).
 */
export function normalizeGitRemote(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;

  // scp-like : git@host:path
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?![/\d])(.+)$/.exec(s);
  if (scp && !s.includes("://")) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    s = s.replace(/^[^/@]+@/, "");
    // host:port → on garde l'hôte seul, le port n'identifie pas le dépôt
    s = s.replace(/^([\w.-]+):\d+\//, "$1/");
  }

  s = s.replace(/\/+$/, "");
  s = s.replace(/\.git$/i, "");
  s = s.replace(/\/{2,}/g, "/");

  const [host, ...rest] = s.split("/");
  if (!host || !host.includes(".") || rest.length === 0 || rest.some((p) => p === "")) {
    return null;
  }
  return `${host}/${rest.join("/")}`.toLowerCase();
}

/** Dernier segment de la clé normalisée : `github.com/parade/paradeos` → `paradeos`. */
export function gitRemoteBasename(remote: string): string {
  const parts = remote.split("/");
  return parts[parts.length - 1] ?? remote;
}
