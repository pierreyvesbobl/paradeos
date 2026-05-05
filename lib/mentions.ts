/**
 * Helpers de parsing pour les mentions dans le contenu d'une note.
 *
 *   @prenom        → mention d'un user (matched par lowercase du prénom
 *                    ou du nom complet sans espaces)
 *   #project:slug  → lien vers projet (idem opp/contact/entity/task)
 *
 * On extrait uniquement les @ ici — les # sont gérés via inlineLinkify
 * dans le composant Markdown.
 */

const USER_MENTION_RE = /@([\p{L}][\p{L}\p{N}_-]*)/giu;

export function extractUserMentionTokens(content: string): string[] {
  const tokens = new Set<string>();
  for (const m of content.matchAll(USER_MENTION_RE)) {
    const token = m[1]?.toLowerCase();
    if (token) tokens.add(token);
  }
  return [...tokens];
}

/**
 * À partir d'une liste d'utilisateurs (id + fullName), retourne la table
 * de résolution token → userId. On indexe le prénom (premier mot, lowercase)
 * et le nom complet "snake" (espaces → vide). Les collisions sur prénom
 * sont gérées en gardant le premier user trouvé — l'utilisateur peut
 * toujours utiliser le nom complet pour désambiguïser (ex. @PierreYves).
 */
export function buildUserMentionResolver(
  users: { id: string; fullName: string | null }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of users) {
    if (!u.fullName) continue;
    const trimmed = u.fullName.trim();
    if (!trimmed) continue;

    const firstName = trimmed.split(/\s+/)[0]?.toLowerCase();
    const compact = trimmed.replace(/\s+/g, "").toLowerCase();

    if (firstName && !map[firstName]) map[firstName] = u.id;
    if (compact && !map[compact]) map[compact] = u.id;
  }
  return map;
}

/**
 * Convertit la liste de tokens trouvés dans le contenu en liste de
 * userIds uniques mentionnés.
 */
export function resolveMentionedUserIds(
  tokens: string[],
  resolver: Record<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const token of tokens) {
    const id = resolver[token];
    if (id) ids.add(id);
  }
  return [...ids];
}
