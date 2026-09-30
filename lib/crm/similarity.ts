/**
 * Similarité trigram, portage JS de `pg_trgm.similarity()`.
 *
 * Pourquoi en JS alors que Postgres sait le faire : le dédoublonnage
 * compare des **clés normalisées** (`lib/crm/name-key.ts`) — sans accent,
 * sans ponctuation, sans forme juridique. Reproduire cette normalisation
 * en SQL demanderait de dupliquer la liste des formes juridiques dans une
 * fonction Postgres, avec le risque classique des deux implémentations qui
 * divergent. Les volumétries du CRM (dizaines à centaines de lignes par
 * table) rendent le scan côté application indolore, et le matching devient
 * testable sans base.
 *
 * Algorithme pg_trgm, respecté à l'identique pour que les seuils calibrés
 * sur `similarity()` gardent leur sens : chaque mot est encadré de deux
 * espaces devant et un derrière, on en extrait les trigrammes distincts,
 * puis on renvoie |intersection| / |union|.
 */

/** Trigrammes distincts d'une chaîne, à la façon de `show_trgm()`. */
export function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  const words = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 0);
  for (const word of words) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/**
 * Similarité entre deux chaînes, dans [0, 1]. Deux chaînes vides valent 0
 * (pas d'information → pas de match).
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
  }
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}
