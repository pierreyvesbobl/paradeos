/**
 * Un remote normalisé par lib/git/remote.ts (`github.com/owner/repo`)
 * ramené à ses coordonnées GitHub. Null pour tout ce qui n'est pas un dépôt
 * github.com à deux segments (GitLab, local/, sous-groupes).
 */
export function parseGithubRepo(remote: string | null | undefined): {
  owner: string;
  repo: string;
} | null {
  if (!remote) return null;
  const m = /^github\.com\/([\w.-]+)\/([\w.-]+)$/i.exec(remote.trim());
  if (!m?.[1] || !m[2]) return null;
  return { owner: m[1], repo: m[2] };
}
