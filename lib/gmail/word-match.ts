/**
 * `\b` de JavaScript ne connaît que l'ASCII : devant « échoué » ou
 * « événement », il n'y a pas de frontière de mot. Ces motifs posent la
 * frontière sur les lettres et chiffres Unicode.
 */
export function words(alternatives: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");
}

/** Deux groupes de mots, le second après le premier, n'importe où dans l'objet. */
export function wordsThen(first: string, second: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${first})(?![\\p{L}\\p{N}]).*(?<![\\p{L}\\p{N}])(?:${second})`,
    "iu",
  );
}
