/**
 * Valide un paramètre `next` de redirection post-authentification.
 * N'accepte qu'un chemin relatif à l'origine : `//evil.tld` (URL
 * protocol-relative) et les URL absolues seraient des redirections
 * ouvertes, précisément sur les liens d'invitation et de reset envoyés
 * par e-mail. Même règle que le middleware et le formulaire de login.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
